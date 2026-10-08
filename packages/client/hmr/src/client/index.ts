/** Web SSE transport for page-owned client entry reconciliation and rebuilt code replacement. */
import type { Context } from '@deepseek-ai/cordis'
import type { PluginsEventParseResult } from '../events.ts'
import { EVENTS_ROUTE, parsePluginsEventFrame } from '../events.ts'

export type { PluginsEventFrame } from '../events.ts'

/** Cordis plugin name. */
export const name = 'client-hmr'

/** Required service: the client module system whose entry controller handles received frames. */
export const inject = ['modules']

/** Page operations replaced by tests. */
export const internals: { reloadPage: () => void } = {
  reloadPage: () => { location.reload() },
}

/**
 * Read a received graph's consistency anchor; the module controller validates the rest.
 * @param graph - JSON-decoded graph from the wire.
 * @returns its `rev`, or undefined when absent.
 */
function graphRevision(graph: unknown): unknown {
  return typeof graph === 'object' && graph !== null && 'rev' in graph ? graph.rev : undefined
}

/**
 * Forward graph snapshots and rebuilds to the page's shared serial controller.
 *
 * Every (re)connection opens with the Host's current graph. When that first
 * graph differs from the one the page runs, the Host was restarted with other
 * code while the page was disconnected; the page reloads instead of replacing
 * its plugins in place, which renders the shell against a half-replaced plugin
 * set. Graphs that change during a connection still apply live.
 * @param ctx - Plugin context with the client module system.
 */
export function apply(ctx: Context): void {
  const entries = ctx.modules.entries
  const handle = (frame: Extract<PluginsEventParseResult, { kind: 'frame' }>['frame']): void => {
    const run = frame.type === 'graph'
      ? Promise.resolve().then(() => entries.sync(frame.graph))
      : entries.reload(frame.id, frame.rev)
    void run.catch((error: unknown) => { ctx.logger.error(error) })
  }

  ctx.effect(() => {
    const source = new EventSource(EVENTS_ROUTE)
    let opening = true
    source.addEventListener('open', () => { opening = true })
    source.addEventListener('message', (event: MessageEvent<string>) => {
      let value: unknown
      try {
        value = JSON.parse(event.data) as unknown
      } catch {
        // Wire boundary: a malformed transport frame is dropped loudly.
        ctx.logger.warn(`client-hmr: unparseable event frame: ${event.data}`)
        return
      }
      const parsed = parsePluginsEventFrame(value)
      if (parsed.kind === 'invalid') {
        ctx.logger.warn(`client-hmr: invalid event frame: ${event.data}`)
      } else if (parsed.kind === 'frame') {
        if (opening && parsed.frame.type === 'graph') {
          opening = false
          if (graphRevision(parsed.frame.graph) !== ctx.modules.manifest.rev) {
            ctx.logger.info('client-hmr: the Host serves another client graph after reconnecting; reloading the page')
            source.close()
            internals.reloadPage()
            return
          }
        }
        handle(parsed.frame)
      }
    })
    return () => { source.close() }
  }, 'client-hmr: event source')
}
