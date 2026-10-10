import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const server = fileURLToPath(new URL('../', import.meta.url))
const nativePackages = ['@deepseek-ai/dsh-subprocess-local', 'node-pty', 'koffi', 'protobufjs']

// The installer has fixed system destinations. Relocate only those paths in a
// private copy; its shell control flow and every command invocation stay intact.
function fixture(t, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-server-')))
  t.after(() => {
    assert.equal(dirname(root), realpathSync(tmpdir()))
    assert.ok(basename(root).startsWith('dsh-server-'))
    rmSync(root, { recursive: true, force: true })
  })
  const bin = join(root, 'bin')
  const source = join(root, 'source')
  const modules = join(root, 'npm/@deepseek-ai/dsh/node_modules')
  for (const directory of [bin, source, modules, 'etc/sudoers.d', 'etc/systemd/system', 'etc/nginx/sites-available', 'etc/nginx/sites-enabled', 'usr/local/sbin', 'home/dsh/.dsh-remote']) {
    mkdirSync(resolve(root, directory), { recursive: true })
  }
  const relocate = text => text.replace(/\/(?:usr\/local|home\/dsh|opt|etc|root|tmp)(?=\/|[\s";])/g, path => root + path)
  for (const file of readdirSync(server, { withFileTypes: true })) {
    if (file.isFile()) writeFileSync(join(source, file.name), relocate(readFileSync(join(server, file.name), 'utf8')), { mode: 0o755 })
  }
  for (const name of options.packages ?? nativePackages) mkdirSync(join(modules, name), { recursive: true })
  const events = join(root, 'events')
  writeFileSync(events, '')
  const mock = join(root, 'mock.mjs')
  writeFileSync(mock, `#!${process.execPath}
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'
const env = process.env
const name = basename(process.argv[1])
const args = process.argv.slice(2)
const root = env.MOCK_ROOT
appendFileSync(env.MOCK_EVENTS, JSON.stringify({ name, args, cwd: process.cwd() }) + '\\n')
const fail = (message, status = 47) => { console.error(message); process.exit(status) }
const owned = path => { const full = resolve(path); if (!full.startsWith(root + '/')) fail('unowned path: ' + path); return full }
switch (name) {
  case 'node':
    if (args[0] === '-p') { console.log(root + '/bin/node'); break }
    if (args[0] === '-v') { console.log('v' + env.MOCK_NODE_VERSION); break }
    if (args[0] === '-e') {
      const expression = args[1].includes('process.versions.node')
        ? 'Object.defineProperty(process.versions, "node", {value: ' + JSON.stringify(env.MOCK_NODE_VERSION) + '});' + args[1]
        : args[1]
      const child = spawnSync(${JSON.stringify(process.execPath)}, ['-e', expression, ...args.slice(2)], { encoding: 'utf8' })
      process.stdout.write(child.stdout); process.stderr.write(child.stderr); process.exit(child.status ?? 99)
    }
    if (args.includes('set-password')) { process.stdin.resume(); break }
    if (args[0] === env.MOCK_FAIL) fail('native diagnostic: ' + args[0], 42)
    break
  case 'npm':
    if (args[0] === 'root') console.log(root + '/npm')
    else if (env.MOCK_FAIL === 'npm') fail('npm installation diagnostic', 41)
    break
  case 'npx': if (env.MOCK_REBUILD_FAIL === '1') fail('node-gyp rebuild diagnostic', 43); break
  case 'id': console.log('0'); break
  case 'stat': console.log('0'); break
  case 'sshd': console.log('port 22'); break
  case 'dsh': console.log('0.2.0-test'); break
  case 'curl':
    if (args.some(a => a.includes('nodejs.org'))) fail('mock Node download requested')
    if (env.MOCK_HEALTH === 'fail') fail('gateway connection refused', 7)
    console.log('ok'); break
  case 'systemctl':
    if (args[0] === 'restart' && args[1] === 'dsh-web' && env.MOCK_WEB !== 'fail') {
      writeFileSync(root + '/home/dsh/.dsh-remote/url', 'http://127.0.0.1:18790/?token=test\\n')
    }
    break
  case 'install': {
    const paths = []
    for (let i = 0; i < args.length; i++) {
      if (['-m', '-o', '-g'].includes(args[i])) { i++; continue }
      if (!args[i].startsWith('-')) paths.push(owned(args[i]))
    }
    if (args.includes('-d')) for (const path of paths) mkdirSync(path, { recursive: true })
    else copyFileSync(paths[0], paths[1])
    break
  }
  case 'rm': for (const path of args.filter(a => !a.startsWith('-'))) rmSync(owned(path), { force: true }); break
  case 'mktemp': {
    const path = root + '/npm-install.log'
    writeFileSync(path, '')
    console.log(path); break
  }
  case 'apt-get': case 'chmod': case 'chown': case 'visudo': case 'nginx': case 'sleep': break
  default: fail('unexpected mock command: ' + name)
}
`, { mode: 0o755 })
  for (const command of ['node', 'npm', 'npx', 'id', 'stat', 'sshd', 'dsh', 'curl', 'systemctl', 'install', 'rm', 'mktemp', 'apt-get', 'chmod', 'chown', 'visudo', 'nginx', 'sleep']) symlinkSync(mock, join(bin, command))
  // No ambient PATH: only harmless file tools and explicit mocks are reachable.
  for (const command of ['bash', 'sh', 'cat', 'dirname', 'grep', 'seq', 'head', 'awk', 'uname', 'sed', 'ln']) {
    symlinkSync(realpathSync('/usr/bin/' + command), join(bin, command))
  }
  const env = {
    PATH: bin, HOME: join(root, 'home/dsh'), TMPDIR: root,
    MOCK_ROOT: root, MOCK_EVENTS: events, MOCK_NODE_VERSION: options.nodeVersion ?? '22.19.0',
    MOCK_FAIL: options.fail ?? '', MOCK_REBUILD_FAIL: options.rebuildFail ? '1' : '',
    MOCK_HEALTH: options.health ?? 'ok', MOCK_WEB: options.web ?? 'ok',
  }
  return {
    root, bin,
    run(script, args = []) {
      const result = spawnSync('/bin/bash', [join(source, script), ...args], { cwd: root, env, encoding: 'utf8', timeout: 20_000 })
      assert.equal(result.error, undefined, String(result.error))
      assert.equal(result.signal, null, result.stderr)
      return { ...result, events: readFileSync(events, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
    },
  }
}

const platform = { skip: process.platform !== 'linux' ? 'Debian/Ubuntu shell installer uses Linux tools' : false }
const domainArgs = ['--domain', 'dsh.example.com', '--tls', 'none', '--password', 'test-password', '--no-copy-root-keys']

for (const version of ['22.19.0', '22.21.1', '24.0.0', '25.0.0']) {
  test('installer uses selected Node ' + version + ' and waits for gateway health', platform, t => {
    const f = fixture(t, { nodeVersion: version })
    const result = f.run('install.sh', domainArgs)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const unit = readFileSync(join(f.root, 'etc/systemd/system/dsh-gateway.service'), 'utf8')
    assert.ok(unit.includes('ExecStart="' + f.bin + '/node" '), unit)
    assert.match(readFileSync(join(f.root, 'etc/systemd/system/dsh-web.service'), 'utf8'), new RegExp('PATH=' + f.bin + ':'))
    assert.ok(result.events.some(e => e.name === 'curl' && e.args.some(a => a.endsWith('/__dsh/health'))))
    assert.match(result.stdout, /DSH Remote server is ready/)
  })
}

for (const version of ['20.20.0', '22.18.0', '23.0.0']) {
  test('installer replaces unsupported Node ' + version, platform, t => {
    const result = fixture(t, { nodeVersion: version }).run('install.sh', domainArgs)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /mock Node download requested/)
    assert.doesNotMatch(result.stdout, /server is ready/)
  })
}

test('installer stops before service commands when a native build fails', platform, t => {
  const result = fixture(t, { fail: 'scripts/ensure-spawn-helper.mjs' }).run('install.sh', domainArgs)
  assert.equal(result.status, 42, result.stderr)
  assert.match(result.stderr, /native diagnostic/)
  assert.ok(!result.events.some(e => e.name === 'systemctl'))
  assert.doesNotMatch(result.stdout, /server is ready/)
})

test('installer supports SSH-only access without a gateway', platform, t => {
  const result = fixture(t).run('install.sh', ['--no-copy-root-keys'])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!result.events.some(e => e.name === 'curl'))
  assert.ok(!result.events.some(e => e.name === 'systemctl' && e.args.includes('dsh-gateway')))
  assert.match(result.stdout, /server is ready/)
})

test('installer fails when gateway health never responds', platform, t => {
  const result = fixture(t, { health: 'fail' }).run('install.sh', domainArgs)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /dsh-gateway did not become healthy/)
  assert.doesNotMatch(result.stdout, /server is ready/)
})

test('installer does not accept a stale web URL after restart', platform, t => {
  const f = fixture(t, { web: 'fail' })
  writeFileSync(join(f.root, 'home/dsh/.dsh-remote/url'), 'http://old.example/\n')
  const result = f.run('install.sh', ['--no-copy-root-keys'])
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /dsh-web did not start/)
  assert.doesNotMatch(result.stdout, /server is ready/)
})

for (const fail of ['scripts/ensure-spawn-helper.mjs', 'scripts/post-install.js', './cnoke.cjs', 'scripts/postinstall']) {
  test('updater retains diagnostics and avoids restart after ' + fail + ' fails', platform, t => {
    const result = fixture(t, { fail }).run('dsh-update')
    assert.equal(result.status, 42, result.stderr)
    assert.ok(result.stderr.includes('native diagnostic: ' + fail), result.stderr)
    assert.match(result.stderr, /services were not restarted/)
    assert.ok(!result.events.some(e => e.name === 'systemctl'))
    assert.ok(!result.events.some(e => e.name === 'dsh'))
  })
}

test('node-pty failed rebuild stops before postinstall or restart', platform, t => {
  const result = fixture(t, { fail: 'scripts/prebuild.js', rebuildFail: true }).run('dsh-update')
  assert.equal(result.status, 43, result.stderr)
  assert.match(result.stderr, /node-gyp rebuild diagnostic/)
  assert.ok(!result.events.some(e => e.name === 'node' && e.args[0] === 'scripts/post-install.js'))
  assert.ok(!result.events.some(e => e.name === 'systemctl'))
})

test('node-pty successful rebuild continues postinstall before restarting', platform, t => {
  const result = fixture(t, { fail: 'scripts/prebuild.js' }).run('dsh-update', ['0.2.0'])
  assert.equal(result.status, 0, result.stderr)
  const rebuild = result.events.findIndex(e => e.name === 'npx')
  const postinstall = result.events.findIndex(e => e.name === 'node' && e.args[0] === 'scripts/post-install.js')
  const restart = result.events.findIndex(e => e.name === 'systemctl')
  assert.ok(rebuild >= 0 && rebuild < postinstall && postinstall < restart)
})

test('updater successful prebuild skips rebuild and supports no-restart', platform, t => {
  const result = fixture(t).run('dsh-update', ['next', '--no-restart'])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!result.events.some(e => e.name === 'npx' || e.name === 'systemctl'))
  assert.ok(result.events.some(e => e.name === 'node' && e.args[0] === 'scripts/post-install.js'))
  assert.ok(result.events.some(e => e.name === 'dsh'))
})

test('updater skips absent optional native packages and restarts once', platform, t => {
  const result = fixture(t, { packages: [] }).run('dsh-update')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.events.filter(e => e.name === 'systemctl').map(e => e.args), [['restart', 'dsh-web']])
})

test('updater reports npm failure without running native scripts or restarting', platform, t => {
  const result = fixture(t, { fail: 'npm' }).run('dsh-update')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /npm installation diagnostic/)
  assert.ok(!result.events.some(e => ['node', 'npx', 'systemctl'].includes(e.name)))
})

test('updater rejects a package URL before invoking npm', platform, t => {
  const result = fixture(t).run('dsh-update', ['https://example.com/package.tgz'])
  assert.equal(result.status, 2)
  assert.deepEqual(result.events, [])
})
