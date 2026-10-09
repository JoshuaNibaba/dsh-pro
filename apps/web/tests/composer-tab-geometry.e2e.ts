// Browser geometry for the input card across Chat and Trajectory. The browser
// must expose layout-consuming scrollbars. The composer belongs to Chat: the
// Trajectory view renders without it, and returning to Chat restores the card
// where it was.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/composer-tab-geometry', import.meta.url))
/** Records platform-neutral distances between the two tabs' card rectangles. */
const GEOMETRY_EXPECTED = join(SNAPSHOT_DIR, 'geometry.expected.md')
const MODE = webSnapshotMode()

/** Long enough that the transcript overflows the lane's 1000px viewport; the scenario asserts the overflow rather than trusting it. */
const FIXTURE = createChatScrollFixture({
  markerPrefix: 'TAB_GEOMETRY',
  title: 'COMPOSER_TAB_GEOMETRY long session',
  turns: 24,
})
const SEED_ID = 'composer-tab-geometry-web-e2e'

/** Viewport widths the scenario measures at: the card capped, and the card shrinking with the column. */
const WIDE_VIEWPORT = { width: 1680, height: 1000 }
const NARROW_VIEWPORT = { width: 800, height: 1000 }

/**
 * Resize to one measurement viewport after the responsive sidebar and center
 * column finish their track transition.
 * @param page - the page under test.
 * @param viewport - the viewport dimensions to apply.
 * @param sidebarCollapsed - the sidebar state expected at this width.
 */
async function setMeasuredViewport(
  page: Page,
  viewport: { width: number; height: number },
  sidebarCollapsed: boolean,
): Promise<void> {
  await page.setViewportSize(viewport)
  await page.locator('[data-sidebar-collapsed="true"]').waitFor({
    state: sidebarCollapsed ? 'attached' : 'detached',
    timeout: 10_000,
  })
  await page.locator('[data-conversation-scroll]').evaluate(async (host) => {
    const deadline = performance.now() + 5_000
    let previous = host.getBoundingClientRect().width
    let stableFrames = 0
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
      const current = host.getBoundingClientRect().width
      stableFrames = Math.abs(current - previous) < 0.01 ? stableFrames + 1 : 0
      if (stableFrames >= 3) return
      previous = current
    }
    throw new Error('conversation width did not settle after the viewport changed')
  })
}

/** The column scroller and the input card as the browser lays them out, in one tab. */
interface TabMetrics {
  gutter: string
  overflowX: string
  overflowY: string
  band: number
  scrolls: boolean
  /** Whether the input card is laid out (Chat) or hidden with its seat (other views). */
  cardShown: boolean
  cardLeft: number
  cardRight: number
  cardWidth: number
}

/** Chat, then Trajectory, then Chat again, plus the card's distances between the two Chat visits. */
interface TabComparison {
  chat: TabMetrics
  trajectory: TabMetrics
  leftShift: number
  rightShift: number
  widthShift: number
}

/**
 * Measure the column scroller and the input card in the tab currently shown.
 * @param page - the page under test.
 * @returns the scroller's resolved overflow style and the card's rectangle.
 */
function measureTab(page: Page): Promise<TabMetrics> {
  return page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (host === null) throw new Error('conversation column scroller not in the DOM')
    const card = host.querySelector<HTMLElement>('[data-composer-seat] [data-composer-card]')
    if (card === null) throw new Error('no input card inside the composer seat')
    const style = getComputedStyle(host)
    const hostRect = host.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    return {
      gutter: style.scrollbarGutter,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      band: hostRect.width - host.clientWidth,
      scrolls: host.scrollHeight > host.clientHeight,
      cardShown: card.getClientRects().length > 0,
      cardLeft: cardRect.left,
      cardRight: cardRect.right,
      cardWidth: cardRect.width,
    }
  })
}

/**
 * Show one tab and wait for the view that owns it to be laid out.
 * @param page - the page under test.
 * @param tab - the tab to show.
 */
async function showTab(page: Page, tab: 'Chat' | 'Trajectory'): Promise<void> {
  await page.getByRole('tab', { name: tab, exact: true }).click()
  if (tab === 'Trajectory') await page.getByLabel('Trajectory timeline').waitFor({ timeout: 30_000 })
  else await page.locator('[data-conversation-scroll] [data-chat-anchor-key]:visible').first().waitFor({ timeout: 30_000 })
  // Both measurements are taken after a paint, so a rectangle read mid-transition
  // cannot be reported as a shift the cascade did not cause.
  await page.evaluate(() => new Promise<void>((settle) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => { settle() }) })
  }))
}

/**
 * Measure Chat, Trajectory, and Chat again, leaving Chat shown.
 * @param page - the page under test.
 * @returns each tab's metrics and the card's displacement between the two Chat visits.
 */
async function compareTabs(page: Page): Promise<TabComparison> {
  await showTab(page, 'Chat')
  const chat = await measureTab(page)
  await showTab(page, 'Trajectory')
  const trajectory = await measureTab(page)
  await showTab(page, 'Chat')
  const back = await measureTab(page)
  return {
    chat,
    trajectory,
    leftShift: Math.abs(back.cardLeft - chat.cardLeft),
    rightShift: Math.abs(back.cardRight - chat.cardRight),
    widthShift: Math.abs(back.cardWidth - chat.cardWidth),
  }
}

/**
 * Open the seeded session from the sidebar search.
 *
 * Cold summaries carry the temp workspace's basename, so the persisted first
 * message is the stable identity to search for, and the query itself drives the
 * lazy content-index reconciliation. Hand-rolled polling because `expect.poll`
 * is test-scoped and this runs in `beforeAll`.
 * @param page - the page under test.
 */
async function openSeededSession(page: Page): Promise<void> {
  // Search collapsed into a header action; expand it before filling.
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search session names', exact: true })
  await search.fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  const deadline = Date.now() + 60_000
  for (;;) {
    if (await results.count() === 1) break
    if (Date.now() > deadline) throw new Error('seeded session never appeared in the sidebar search results')
    await page.waitForTimeout(200)
  }
  await results.click()
}

/**
 * Render the golden body.
 * @param wide - comparison at the viewport where the card sits at its width cap.
 * @param narrow - comparison at the viewport where the card shrinks with the column.
 * @returns the golden body, without a trailing newline.
 */
function renderGeometry(wide: TabComparison, narrow: TabComparison): string {
  const section = (name: string, comparison: TabComparison): string[] => [
    `## ${name}`,
    '',
    `- Chat: scrollbar-gutter ${comparison.chat.gutter}, overflow ${comparison.chat.overflowX}/${comparison.chat.overflowY}`,
    `- Chat scroller scrolls: ${String(comparison.chat.scrolls)}`,
    `- Chat reserved band: ${String(comparison.chat.band)}px`,
    `- Trajectory: scrollbar-gutter ${comparison.trajectory.gutter}, overflow ${comparison.trajectory.overflowX}/${comparison.trajectory.overflowY}`,
    `- Trajectory scroller scrolls: ${String(comparison.trajectory.scrolls)}`,
    `- Trajectory reserved band: ${String(comparison.trajectory.band)}px`,
    `- input card shown in Chat: ${String(comparison.chat.cardShown)}`,
    `- input card shown in Trajectory: ${String(comparison.trajectory.cardShown)}`,
    `- input card left edge moves after returning to Chat: ${String(comparison.leftShift)}px`,
    `- input card right edge moves after returning to Chat: ${String(comparison.rightShift)}px`,
    `- input card width changes after returning to Chat: ${String(comparison.widthShift)}px`,
    '',
  ]
  return [
    '# Input card position across the Chat and Trajectory tabs',
    '',
    ...section(`Wide viewport (${String(WIDE_VIEWPORT.width)}px, card at its cap)`, wide),
    ...section(`Narrow viewport (${String(NARROW_VIEWPORT.width)}px, card shrinking with the column)`, narrow),
  ].join('\n').trimEnd()
}

describe('web e2e: input card position across view tabs', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, FIXTURE.log, SEED_ID)
    // Scrollbars must take layout space here or the comparison is vacuous.
    browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
    page = await newEnglishPage(browser, WIDE_VIEWPORT.height)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeededSession(page)
    await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor({ timeout: 30_000 })
    await page.getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false }).last()
      .waitFor({ timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('reserves the gutter in Chat and lets Trajectory own its width', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-band'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    // Vacuity guard. The scenario must be able to fail: on an engine that
    // does not implement `scrollbar-gutter`, Chat reserves nothing and the
    // overlay seat's fixed compensation stands alone, manufacturing an 8px
    // deviation the equal-rectangle assertions would catch. `stable` reserves
    // even without overflow, so a short transcript is not a vacuous case; the
    // poll still pins the measurement to the overflowing state the product
    // ships.
    await expect.poll(async () => (await measureTab(page)).scrolls, { timeout: 10_000 }).toBe(true)
    const comparison = await compareTabs(page)
    expect(comparison.chat.band).toBeGreaterThan(0)
    // Chat keeps the unconditional reservation so its seat's content box never
    // jumps as the transcript starts to scroll.
    expect(comparison.chat.gutter).toBe('stable')
    // The overlay branch does NOT reserve: the view owns its own scrollers, so
    // a reserved gutter would only narrow the view's content by the bar's
    // width. The seat compensates instead, which the next test asserts.
    expect(comparison.trajectory.gutter).toBe('auto')
    expect(comparison.trajectory.band).toBe(0)
    // Declared as a scroll container on both axes rather than left to compute:
    // `overflow: hidden` would drop any reservation in WebKit, and a `visible`
    // horizontal axis computes to `auto` beside a scrolling one.
    expect(comparison.trajectory.overflowY).toBe('auto')
    expect(comparison.trajectory.overflowX).toBe('hidden')
    // Only Chat scrolls this box; the Trajectory view owns its own scrollers.
    expect(comparison.trajectory.scrolls).toBe(false)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('hides the input card in Trajectory and restores it in place in Chat', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-wide'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    const comparison = await compareTabs(page)
    expect(comparison.chat.cardShown).toBe(true)
    expect(comparison.trajectory.cardShown).toBe(false)
    expect(comparison.leftShift).toBe(0)
    expect(comparison.rightShift).toBe(0)
    expect(comparison.widthShift).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('restores the input card in place at a viewport where it shrinks with the column', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-narrow'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    const capped = await measureTab(page)
    await setMeasuredViewport(page, NARROW_VIEWPORT, true)
    const comparison = await compareTabs(page)
    // Below the cap the card takes the column's width; returning from
    // Trajectory must restore that width, not the capped one.
    expect(comparison.chat.cardWidth).toBeLessThan(capped.cardWidth)
    expect(comparison.trajectory.cardShown).toBe(false)
    expect(comparison.leftShift).toBe(0)
    expect(comparison.rightShift).toBe(0)
    expect(comparison.widthShift).toBe(0)
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('matches the committed tab geometry golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-golden'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    const wide = await compareTabs(page)
    await setMeasuredViewport(page, NARROW_VIEWPORT, true)
    const narrow = await compareTabs(page)
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, renderGeometry(wide, narrow), MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('commits exactly the fixtures it reads', async () => {
    // The seeded session is generated in-process, so the geometry golden is the
    // whole inventory.
    await assertFixtureInventory(SNAPSHOT_DIR, ['geometry.expected.md'])
  })

  it.skipIf(MODE === 'record')('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
