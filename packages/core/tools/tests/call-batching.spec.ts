import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config } from '@deepseek-ai/dsh-tools'

const INSTRUCTION = 'When you need several tool calls whose inputs do not depend on each other\'s results, '
  + 'request them together in one response instead of one call per response. '
  + 'Reads and web requests requested together run concurrently.'

async function sectionText(config: Config): Promise<string | undefined> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, config)
  const assembly = await ctx.systemPrompt.assemble()
  const text = assembly.sections.find(section => section.name === 'tools:call-batching')?.text
  await ctx.fiber.dispose()
  return text
}

describe('independent tool-call batching section', () => {
  it('is absent unless the deployment enables it', async () => {
    expect(await sectionText({ mode: 'native' })).toBeUndefined()
  })

  it('asks a native presentation to batch independent calls', async () => {
    expect(await sectionText({ mode: 'native', batchIndependentCalls: true })).toBe(INSTRUCTION)
  })
})
