#!/usr/bin/env node
// DSH Remote gateway: a password login in front of a loopback `dsh web`.
//
//   node gateway.mjs serve          [--config FILE]   run the gateway
//   node gateway.mjs set-password   [--config FILE]   read a password from stdin,
//                                                      store its scrypt hash and rotate
//                                                      the session secret (logs out everyone)
//
// A browser that submits the password receives a signed `dsh_gate` cookie
// (default lifetime 365 days, renewed while in use). Requests carrying a valid
// cookie are proxied, Host unchanged, to dsh web; dsh's own launch-token login
// is completed by the gateway by redirecting page loads that dsh answers with
// 401 to `/?token=<current token>`. WebSocket upgrades are proxied as raw TCP.
//
// Config file (JSON, default /etc/dsh-remote/gateway.json):
//   listen         "127.0.0.1:18800"
//   upstream       "127.0.0.1:18790"
//   urlFile        "/home/dsh/.dsh-remote/url"   written by run-web.sh
//   passwordHash   "scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>"
//   sessionSecret  hex string
//   sessionDays    365
//   secureCookie   true when browsers reach the gateway over HTTPS

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'

const COOKIE = 'dsh_gate'
const PREFIX = '/__dsh'
/** dsh's install metadata and icons, served without a session. */
const PUBLIC_ASSET = /^\/(?:manifest\.webmanifest|favicon(?:-dark)?\.svg|icons\/[A-Za-z0-9-]+\.png)$/

function parseArgs(argv) {
  const out = { command: argv[0] ?? 'serve', config: '/etc/dsh-remote/gateway.json' }
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--config') out.config = argv[++i]
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  return out
}

function readConfig(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
}

function hostPort(value, name) {
  const m = /^(.+):(\d+)$/.exec(value ?? '')
  if (!m) throw new Error(`config ${name} must be host:port, got ${JSON.stringify(value)}`)
  return { host: m[1], port: Number(m[2]) }
}

// ---------- password ----------

const SCRYPT = { N: 1 << 15, r: 8, p: 1 }

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 32, { ...SCRYPT, maxmem: 64 << 20 })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored).split('$')
  if (kind !== 'scrypt' || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 << 20 })
  return crypto.timingSafeEqual(actual, expected)
}

async function setPassword(file) {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
  if (password.length < 8) throw new Error('password must be at least 8 characters')
  const config = readConfig(file)
  config.passwordHash = hashPassword(password)
  config.sessionSecret = crypto.randomBytes(32).toString('hex')
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o640 })
  fs.renameSync(tmp, file)
  console.log(`password updated in ${file}; existing browser logins are invalidated`)
}

// ---------- session cookie ----------

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

function issueSession(config) {
  const exp = Math.floor(Date.now() / 1000) + config.sessionDays * 86400
  const payload = `v1.${exp}`
  return { value: `${payload}.${sign(config.sessionSecret, payload)}`, exp }
}

/** @returns the session expiry in epoch seconds, or 0 when absent or invalid. */
function sessionExpiry(config, req) {
  const raw = readCookie(req.headers.cookie, COOKIE)
  if (!raw) return 0
  const i = raw.lastIndexOf('.')
  const payload = raw.slice(0, i)
  const mac = Buffer.from(raw.slice(i + 1))
  const good = Buffer.from(sign(config.sessionSecret, payload))
  if (mac.length !== good.length || !crypto.timingSafeEqual(mac, good)) return 0
  const [v, exp] = payload.split('.')
  const n = Number(exp)
  return v === 'v1' && n > Date.now() / 1000 ? n : 0
}

function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}

function withoutCookie(header, name) {
  if (!header) return header
  const kept = header.split(';').map((s) => s.trim()).filter((s) => s && !s.startsWith(`${name}=`))
  return kept.length ? kept.join('; ') : undefined
}

function sessionCookie(config, value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${config.secureCookie ? '; Secure' : ''}`
}

// ---------- login throttling ----------

const failures = new Map() // ip -> { count, until }
let globalFailures = []

function throttled(ip) {
  const now = Date.now()
  globalFailures = globalFailures.filter((t) => now - t < 15 * 60_000)
  const f = failures.get(ip)
  return (f && f.until > now) || globalFailures.length >= 50
}

function recordFailure(ip) {
  const now = Date.now()
  globalFailures.push(now)
  const f = failures.get(ip) ?? { count: 0, until: 0 }
  f.count += 1
  if (f.count >= 5) { f.until = now + 15 * 60_000; f.count = 0 }
  failures.set(ip, f)
}

function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] ?? req.headers['x-real-ip'] ?? req.socket.remoteAddress)
}

// ---------- pages ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function page(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark"><title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font:16px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6f8;color:#222}
@media(prefers-color-scheme:dark){body{background:#17181a;color:#ddd}.card{background:#232427!important}input{background:#17181a;color:#ddd;border-color:#444!important}}
.card{width:min(360px,92vw);background:#fff;border-radius:14px;padding:28px 24px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 18px}input{width:100%;font-size:17px;padding:12px;border:1px solid #ccd;border-radius:9px;margin-bottom:14px}
button{width:100%;font-size:17px;padding:12px;border:0;border-radius:9px;background:#4d6bfe;color:#fff}
.err{color:#d33;font-size:14px;margin:-4px 0 12px}.hint{font-size:13px;opacity:.6;margin-top:14px}
</style></head><body><div class="card">${body}</div></body></html>`
}

function loginPage(next, error) {
  return page('登录 DSH', `<h1>DSH</h1>
<form method="post" action="${PREFIX}/login">
<input type="hidden" name="next" value="${esc(next)}">
<input type="text" name="username" value="dsh" autocomplete="username" hidden>
<input type="password" name="password" placeholder="访问密码" autocomplete="current-password" autofocus required>
${error ? `<div class="err">${esc(error)}</div>` : ''}<button type="submit">登录</button></form>
<div class="hint">登录后本设备会保持登录。</div>`)
}

function send(res, status, html, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(html)
}

function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith(PREFIX) ? next : '/'
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('body too large')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// ---------- dsh launch token ----------

function currentToken(config) {
  try {
    const url = new URL(fs.readFileSync(config.urlFile, 'utf8').trim())
    return url.searchParams.get('token') ?? undefined
  } catch {
    return undefined // run-web.sh has not written the URL yet
  }
}

function isPageLoad(req) {
  return req.method === 'GET'
    && (req.headers['sec-fetch-mode'] === 'navigate' || String(req.headers.accept ?? '').includes('text/html'))
}

// ---------- server ----------

function serve(configFile) {
  const config = { sessionDays: 365, secureCookie: true, ...readConfig(configFile) }
  if (!config.passwordHash || !config.sessionSecret) throw new Error(`${configFile}: run set-password first`)
  const listen = hostPort(config.listen ?? '127.0.0.1:18800', 'listen')
  const upstream = hostPort(config.upstream ?? '127.0.0.1:18790', 'upstream')
  config.urlFile ??= '/home/dsh/.dsh-remote/url'

  async function handleLogin(req, res, url) {
    if (req.method === 'GET') return send(res, 200, loginPage(safeNext(url.searchParams.get('next'))))
    if (req.method !== 'POST') return send(res, 405, 'method not allowed')
    const ip = clientIp(req)
    const form = new URLSearchParams(await readBody(req))
    const next = safeNext(form.get('next'))
    if (throttled(ip)) return send(res, 429, loginPage(next, '尝试次数过多,请 15 分钟后再试'))
    if (!verifyPassword(form.get('password') ?? '', config.passwordHash)) {
      recordFailure(ip)
      await new Promise((r) => setTimeout(r, 800))
      console.log(`login failed from ${ip}`)
      return send(res, 401, loginPage(next, '密码不正确'))
    }
    failures.delete(ip)
    console.log(`login ok from ${ip}`)
    const s = issueSession(config)
    res.writeHead(303, {
      location: next,
      'set-cookie': sessionCookie(config, s.value, config.sessionDays * 86400),
      'cache-control': 'no-store',
    })
    res.end()
  }

  function proxy(req, res, renew) {
    const headers = { ...req.headers, cookie: withoutCookie(req.headers.cookie, COOKIE) }
    if (headers.cookie === undefined) delete headers.cookie
    const up = http.request({ ...upstream, method: req.method, path: req.url, headers }, (ur) => {
      if (ur.statusCode === 401 && isPageLoad(req)) {
        ur.resume()
        const token = currentToken(config)
        if (!token || new URL(req.url, 'http://x').searchParams.has('token')) {
          return send(res, 503, page('DSH 正在启动', '<h1>DSH 正在启动…</h1><p>几秒后自动刷新。</p><script>setTimeout(()=>location.replace("/"),3000)</script>'))
        }
        return send(res, 303, '', { location: `/?token=${encodeURIComponent(token)}` })
      }
      const h = { ...ur.headers }
      delete h.connection
      delete h['keep-alive']
      if (config.secureCookie && h['set-cookie']) {
        h['set-cookie'] = h['set-cookie'].map((c) => (/;\s*secure/i.test(c) ? c : `${c}; Secure`))
      }
      if (renew) h['set-cookie'] = [...(h['set-cookie'] ?? []), renew]
      res.writeHead(ur.statusCode, ur.statusMessage, h)
      ur.pipe(res)
    })
    up.on('error', (e) => {
      console.error(`upstream error: ${e.message}`)
      if (!res.headersSent) send(res, 502, page('DSH 不可用', '<h1>DSH 服务暂不可用</h1><p>请稍后刷新。</p>'))
      else res.destroy()
    })
    req.pipe(up)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://gateway')
    if (url.pathname === `${PREFIX}/health`) return send(res, 200, 'ok', { 'content-type': 'text/plain' })
    if (url.pathname === `${PREFIX}/login`) {
      return void handleLogin(req, res, url).catch((e) => { console.error(e); if (!res.headersSent) send(res, 400, 'bad request') })
    }
    if (url.pathname === `${PREFIX}/logout`) {
      return send(res, 303, '', { location: `${PREFIX}/login`, 'set-cookie': sessionCookie(config, '', 0) })
    }
    const exp = sessionExpiry(config, req)
    // Home-screen installers fetch the manifest and launcher icons without cookies;
    // these are dsh's public static files, so they bypass the login.
    if (!exp && (req.method === 'GET' || req.method === 'HEAD') && PUBLIC_ASSET.test(url.pathname)) {
      return proxy(req, res, undefined)
    }
    if (!exp) {
      if (isPageLoad(req)) return send(res, 303, '', { location: `${PREFIX}/login?next=${encodeURIComponent(safeNext(req.url))}` })
      return send(res, 401, 'login required', { 'content-type': 'text/plain' })
    }
    // Sliding renewal: reissue once less than half of the lifetime remains.
    const renew = exp - Date.now() / 1000 < config.sessionDays * 43200
      ? sessionCookie(config, issueSession(config).value, config.sessionDays * 86400)
      : undefined
    proxy(req, res, renew)
  })

  server.on('upgrade', (req, socket, head) => {
    if (!sessionExpiry(config, req)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    const up = net.connect(upstream.port, upstream.host, () => {
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        let [k, v] = [req.rawHeaders[i], req.rawHeaders[i + 1]]
        if (k.toLowerCase() === 'cookie') { v = withoutCookie(v, COOKIE); if (!v) continue }
        raw += `${k}: ${v}\r\n`
      }
      up.write(`${raw}\r\n`)
      if (head?.length) up.write(head)
      up.pipe(socket)
      socket.pipe(up)
    })
    const close = () => { up.destroy(); socket.destroy() }
    up.on('error', close)
    socket.on('error', close)
    up.on('close', close)
    socket.on('close', close)
  })

  server.keepAliveTimeout = 65_000
  server.listen(listen.port, listen.host, () => {
    console.log(`dsh gateway listening on ${listen.host}:${listen.port} -> ${upstream.host}:${upstream.port}`)
  })
}

const args = parseArgs(process.argv.slice(2))
if (args.command === 'serve') serve(args.config)
else if (args.command === 'set-password') await setPassword(args.config)
else {
  console.error('usage: gateway.mjs serve|set-password [--config FILE]')
  process.exit(2)
}
