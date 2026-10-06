/** Real YAML Loader composition, authenticated HTTP output and route disposal. */
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection/src/index.ts'
import { afterEach, describe, expect, it } from 'vitest'
import * as Status from '../src/index.ts'
import { parseSnapshot } from '../src/wire.ts'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'

type Credentials = Context['credentials']

/** Supply isolated credential records and a token-exchange index route.
 * @param ctx Fixture plugin context.
 */
function applyCredentials(ctx: Context): void {
  let record: Awaited<ReturnType<Credentials['readRecord']>>
  class TestCredentials extends CredentialProvider {
    resolve(): never { throw new Error('reference resolution is outside this fixture') }
    describe(): never { throw new Error('reference description is outside this fixture') }
    set(): never { throw new Error('reference writes are outside this fixture') }
    unset(): never { throw new Error('reference deletion is outside this fixture') }
    describeRecord(): never { throw new Error('record description is outside this fixture') }
    listRecords(): never { throw new Error('record enumeration is outside this fixture') }
    deleteRecord(): never { throw new Error('record deletion is outside this fixture') }
    readRecord(): ReturnType<Credentials['readRecord']> { return Promise.resolve(record) }
    async modifyRecord(_key: Parameters<Credentials['modifyRecord']>[0], mutate: Parameters<Credentials['modifyRecord']>[1]) {
      const next = await mutate(record)
      if (next !== undefined) record = next
      return record
    }
  }
  new TestCredentials(ctx)
  ctx.inject(['connection', 'webServer'], (owner) => {
    owner.effect(() => owner.webServer.register({
      kind: 'exact', path: '/',
      handler(request, response) {
        if (!owner.connection.authorizeIndex(request, response)) return
        response.writeHead(200)
        response.end('ready')
      },
    }))
  })
}

let ctx: Context | undefined
let fixtureDir: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (fixtureDir !== undefined) {
    if (!fixtureDir.startsWith(join(tmpdir(), 'dsh-server-status-host-'))) throw new Error('unexpected fixture directory')
    await rm(fixtureDir, { recursive: true, force: true })
    fixtureDir = undefined
  }
})

describe('server status in a real Loader composition', () => {
  it('serves authenticated readings through the real Connection and removes its HTTP route', async () => {
    ctx = new Context()
    const errors: string[] = []
    ctx.logger.exporter({ export(message) { if (message.type === 'error') errors.push(message.args.map(arg => arg instanceof Error ? arg.stack : String(arg)).join(' ')) } })
    ctx.baseUrl = new URL('./fixtures/', import.meta.url).href
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins['web-server'] = WebServer
    ctx.loader.builtins.connection = Connection
    ctx.loader.builtins['server-status-test-connection'] = { name: 'server-status-test-connection', apply: applyCredentials }
    ctx.loader.builtins['server-status'] = Status
    fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-server-status-host-'))
    const configPath = join(fixtureDir, 'cordis.yml')
    await writeFile(configPath, await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8'))
    await ctx.loader.create({ name: 'cordis:include', config: { path: configPath } })
    await ctx.loader.await()
    const entry = [...ctx.loader.entries()].find(row => row.options.name === 'cordis:server-status')
    expect(errors).toEqual([])
    expect(entry?.fiber).toBeDefined()
    expect('default' in Status).toBe(false)
    expect(ctx.webServer.collectIndexInjections()).toContainEqual({ kind: 'global', name: '__DSH_SERVER_STATUS_CONFIG__', value: { sampleIntervalMs: 250, requestTimeoutMs: 1234 } })
    const base = `http://127.0.0.1:${ctx.webServer.port}`
    const request = (endpoint: string, cookie?: string) => fetch(`${base}/server-status/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
      body: JSON.stringify({ type: 'client-request', rpcId: 'status-test', method: endpoint, payload: {} }),
    })
    const unauthorized = await request('snapshot')
    expect(unauthorized.status).toBe(401)
    await unauthorized.text()
    const launch = await fetch(ctx.connection.authenticatedUrl(base), { redirect: 'manual' })
    const cookie = launch.headers.get('set-cookie')?.split(';', 1)[0]
    await launch.text()
    expect(cookie).toBeDefined()
    const response = await request('snapshot', cookie)
    expect(response.status).toBe(200)
    const result = Connection.serverResponseSchema.parse(await response.json())
    expect(result).toMatchObject({ type: 'server-response', rpcId: 'status-test', result: { ok: true } })
    if (!result.result.ok) throw new Error(result.result.error.message)
    const snapshot = parseSnapshot(result.result.value)
    if (platform() === 'linux') {
      expect(snapshot.memory?.totalBytes).toBeGreaterThan(0)
      expect(snapshot.memory?.usedBytes).toBeGreaterThanOrEqual(0)
    } else {
      expect(snapshot.memory).toBeNull()
    }
    await expect.poll(async () => {
      const sampledResponse = await request('snapshot', cookie)
      expect(sampledResponse.status).toBe(200)
      const sampled = Connection.serverResponseSchema.parse(await sampledResponse.json())
      if (!sampled.result.ok) throw new Error(sampled.result.error.message)
      const cpuPercent = parseSnapshot(sampled.result.value).cpuPercent
      return cpuPercent !== null && Number.isFinite(cpuPercent) && cpuPercent >= 0 && cpuPercent <= 100
    }, { timeout: 3000, interval: 50 }).toBe(true)
    const unsupported = await request('unsupported', cookie)
    expect(await unsupported.json()).toMatchObject({ result: { ok: false, error: { code: 'server-status/not-found' } } })
    await entry!.fiber!.dispose()
    const removed = await request('snapshot', cookie)
    expect(removed.status).toBe(404)
    await removed.text()
    expect(ctx.webServer.collectIndexInjections().some(row => row.kind === 'global' && row.name === '__DSH_SERVER_STATUS_CONFIG__')).toBe(false)
  })
})
