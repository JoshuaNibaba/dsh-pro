/** Real Loader coverage for caller-owned HTTP RPC routes and injection checks. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it } from 'vitest'
import * as Connection from '../src/index.ts'
import { provideBrowserCredentials } from './browser-credentials.ts'

let ctx: Context | undefined
let fixtureDir: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (fixtureDir === undefined) return
  if (dirname(fixtureDir) !== tmpdir() || !basename(fixtureDir).startsWith('dsh-connection-rpc-owner-')) {
    throw new Error('unexpected fixture directory')
  }
  await rm(fixtureDir, { recursive: true, force: true })
  fixtureDir = undefined
})

describe('Connection HTTP RPC ownership in a Loader composition', () => {
  it('uses each consumer injection and removes only the disposed consumer route', async () => {
    ctx = new Context()
    const errors: string[] = []
    ctx.logger.exporter({ export(message) {
      if (message.type === 'error') {
        errors.push(message.args.map(arg => arg instanceof Error ? arg.message : String(arg)).join(' '))
      }
    } })
    ctx.baseUrl = new URL('./fixtures/', import.meta.url).href
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins['web-server'] = WebServer
    ctx.loader.builtins.connection = Connection
    ctx.loader.builtins.credentials = { name: 'credentials', apply(owner: Context) {
      provideBrowserCredentials(owner)
      owner.inject(['connection', 'webServer'], (index) => {
        index.effect(() => index.webServer.register({
          kind: 'exact', path: '/',
          handler(request, response) {
            if (!index.connection.authorizeIndex(request, response)) return
            response.writeHead(200)
            response.end('ready')
          },
        }))
      })
    } }
    ctx.loader.builtins['rpc-owner'] = {
      name: 'rpc-owner', inject: ['connection', 'webServer'],
      apply(owner: Context, config: { channel: string }) {
        const rpc = owner.connection.rpc
        rpc.handle(config.channel, async () => ({ ok: true, value: config.channel }))
      },
    }
    ctx.loader.builtins['rpc-denied'] = {
      name: 'rpc-denied', inject: ['connection'],
      apply(owner: Context) {
        owner.connection.rpc.handle('/denied', async () => ({ ok: true, value: 'denied' }))
      },
    }
    fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-connection-rpc-owner-'))
    const configPath = join(fixtureDir, 'cordis.yml')
    await writeFile(configPath, await readFile(new URL('./fixtures/rpc-owner.yml', import.meta.url), 'utf8'))
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect(errors).toEqual([])
    const entries = [...ctx.loader.entries()]
    const first = entries.find(entry => entry.options.id === 'first')?.fiber
    const second = entries.find(entry => entry.options.id === 'second')?.fiber
    const provider = entries.find(entry => entry.options.name === 'cordis:connection')?.fiber
    if (!first || !second || !provider) throw new Error('missing Loader fixture fibers')
    expect(first.getEffects()).toContainEqual(expect.objectContaining({ label: 'client-connection: /first rpc channel' }))
    expect(second.getEffects()).toContainEqual(expect.objectContaining({ label: 'client-connection: /second rpc channel' }))
    expect(provider.getEffects().some(effect => effect.label.endsWith('rpc channel'))).toBe(false)
    const base = `http://127.0.0.1:${ctx.webServer.port}`
    const launch = await fetch(ctx.connection.authenticatedUrl(base), { redirect: 'manual' })
    const cookie = launch.headers.get('set-cookie')?.split(';', 1)[0]
    await launch.text()
    if (!cookie) throw new Error('missing authenticated browser cookie')
    const request = (channel: string) => fetch(`${base}${channel}/read`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: 'owner-test', method: 'read', payload: {} }),
    })
    for (const channel of ['/first', '/second']) {
      const response = await request(channel)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ rpcId: 'owner-test', result: { ok: true, value: channel } })
    }
    await ctx.loader.create({ name: 'cordis:rpc-denied' })
    await ctx.loader.await()
    const denied = [...ctx.loader.entries()].find(entry => entry.options.name === 'cordis:rpc-denied')?.fiber
    expect(denied?.state).toBe(FiberState.FAILED)
    expect(errors).toEqual([expect.stringContaining('cannot get property "webServer" without inject')])
    const rejected = await request('/denied')
    expect(rejected.status).toBe(404)
    await rejected.text()
    await first.dispose()
    const removed = await request('/first')
    expect(removed.status).toBe(404)
    await removed.text()
    const remaining = await request('/second')
    expect(remaining.status).toBe(200)
    expect(await remaining.json()).toMatchObject({ result: { ok: true, value: '/second' } })
    await second.dispose()
    const final = await request('/second')
    expect(final.status).toBe(404)
    await final.text()
  })
})
