/** Keyless assembled-Web evidence for the experimental Kanban board and its lane dispatch. */

import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const KANBAN_BUNDLE = fileURLToPath(new URL('../../../packages/experimental/kanban-bundle/cordis.patch.yml', import.meta.url))
const PROVIDER = 'kanban-web-test'
const MODEL = 'reply'
const SESSION = SessionId('kanban-web-e2e')
const LANE_TITLE = 'Kanban lane session'
const TASK_TITLE = 'Summarize the release notes'
const TASK_DETAILS = 'Keep it under three bullet points.'

/** Deterministic model seam that records each request and answers with one short reply. */
class KanbanAdapter extends LlmAdapter {
  override async listModels(provider: string) { return [{ provider, id: MODEL, name: `${provider}/${MODEL}` }] }
  readonly prompts: string[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.prompts.push(options.messages.filter(message => message.role === 'user')
      .map(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')).join('\n'))
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Done.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Done.' } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('Kanban Web board', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let handle: AgentHandle
  let tripwire: ReturnType<typeof watchConsole>
  const adapter = new KanbanAdapter()

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: [KANBAN_BUNDLE] })
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter([PROVIDER], adapter), 'Kanban Web adapter')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.addInitScript(() => { localStorage.setItem('dsh.locale', 'en') })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const cwd = join(scaffold.workspaceCwd, 'workspace')
    const workspace = await scaffold.ctx.workspaceRegistry.resolveByPath(cwd)
    if (workspace === undefined) throw new Error('connected Web workspace was not registered')
    handle = await scaffold.ctx.agents.create({ sessionId: SESSION, meta: { cwd }, agentOptions: { provider: PROVIDER, model: MODEL } })
    handle.agent.session.append('session/title', { title: LANE_TITLE, messageSeqs: [], source: { kind: 'user' } })
    await workspace.attachSession(handle.agent.id)
    // A started Session shows its View tabs; a blank one shows the Hero instead.
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('plans a task, queues it on a Session lane, and shows it completed', async () => {
    onTestFailed(async () => { await saveFailureShot(page, 'kanban-board') })
    // The board is a Conversation View tab beside Chat and Trajectory.
    await page.getByText(LANE_TITLE, { exact: true }).first().click()
    const tab = page.locator('[data-conversation-tabs]').getByRole('tab', { name: 'Kanban board', exact: true })
    await tab.click()
    expect(await tab.getAttribute('aria-selected')).toBe('true')
    const board = page.getByTestId('kanban-page')
    await board.waitFor()
    const headerShot = process.env['DSH_KANBAN_HEADER_SCREENSHOT']
    if (headerShot !== undefined) await page.screenshot({ path: headerShot })
    await board.getByRole('button', { name: 'New task', exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'New task', exact: true })
    await editor.getByPlaceholder('What should be done').fill(TASK_TITLE)
    await editor.getByPlaceholder('Extra instructions sent to the session').fill(TASK_DETAILS)
    // The editor fits inside its dialog: no field reaches past the card's edge.
    for (const width of [1680, 420]) {
      await page.setViewportSize({ width, height: 1000 })
      const card = await editor.boundingBox()
      expect(card!.x).toBeGreaterThanOrEqual(0)
      expect(card!.x + card!.width).toBeLessThanOrEqual(width)
      // The title field's outline is its wrapper; both fields share the dialog's right inset.
      const title = await editor.getByPlaceholder('What should be done').locator('..').boundingBox()
      const details = await editor.getByPlaceholder('Extra instructions sent to the session').boundingBox()
      const create = await editor.getByRole('button', { name: 'Create', exact: true }).boundingBox()
      expect(Math.abs(title!.x + title!.width - (details!.x + details!.width))).toBeLessThanOrEqual(1)
      expect(details!.x + details!.width).toBeLessThanOrEqual(card!.x + card!.width - 16)
      expect(create!.x + create!.width).toBeLessThanOrEqual(card!.x + card!.width)
      const shot = process.env['DSH_KANBAN_EDITOR_SCREENSHOT']
      if (shot !== undefined) await page.screenshot({ path: shot.replace('.png', `-${width}.png`) })
    }
    await page.setViewportSize({ width: 1680, height: 1000 })
    await editor.getByRole('button', { name: 'Create', exact: true }).click()
    const plan = board.getByTestId('kanban-column-plan')
    const card = plan.locator('article', { hasText: TASK_TITLE })
    await card.waitFor()
    expect(await card.getAttribute('data-status')).toBe('draft')

    const lane = board.getByTestId(`kanban-lane-${SESSION}`)
    await lane.getByText(LANE_TITLE).waitFor()
    await card.dragTo(lane)

    const done = board.getByTestId('kanban-column-done').locator('article[data-status="done"]', { hasText: TASK_TITLE })
    await done.waitFor({ timeout: 30_000 })
    expect(adapter.prompts).toHaveLength(2)
    expect(adapter.prompts[1]).toContain(`${TASK_TITLE}\n\n${TASK_DETAILS}`)
    const sent = handle.agent.session.snapshotEvents().flatMap(event =>
      event.type === 'user/message' && event.data.source.kind === 'kanban' ? [event.data.content] : [])
    expect(sent).toEqual([[{ type: 'text', text: `${TASK_TITLE}\n\n${TASK_DETAILS}` }]])
    const shot = process.env['DSH_KANBAN_SCREENSHOT']
    if (shot !== undefined) await page.screenshot({ path: shot })
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
