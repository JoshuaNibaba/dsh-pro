/** Durable Kanban tasks for every Workspace, keyed by task id. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { KanbanTask, KanbanTaskId } from './types.ts'

const instant = z.iso.datetime({ precision: 3 })
const identity = z.string().min(1)

const failureSchema = z.object({
  reason: z.enum(['error', 'aborted', 'blocked', 'max-tokens', 'interrupted', 'discarded', 'dispatch']),
  message: z.string().optional(),
}).strict()

/** One stored task; every status except `draft` requires a lane Session. */
export const kanbanTaskSchema = z.object({
  id: identity.transform(value => brandString<KanbanTaskId>(value)),
  workspaceId: identity.transform(value => brandString<WorkspaceId>(value)),
  title: z.string().min(1),
  prompt: z.string(),
  status: z.enum(['draft', 'waiting', 'running', 'attention', 'failed', 'done', 'skipped']),
  sessionId: identity.transform(value => brandString<SessionId>(value)).optional(),
  rank: z.number().int(),
  failure: failureSchema.optional(),
  createdAt: instant,
  updatedAt: instant,
  startedAt: instant.optional(),
  finishedAt: instant.optional(),
}).strict().refine(task => (task.status === 'draft') === (task.sessionId === undefined), {
  message: 'Only draft tasks omit the lane Session',
}).refine(task => (task.status === 'failed' || task.status === 'skipped') || task.failure === undefined, {
  message: 'Only failed or skipped tasks record a failure',
}) satisfies z.ZodType<KanbanTask>

/** Authoritative Kanban storage; a malformed row rejects opening the domain. */
export const kanbanDomain = defineDomain({
  name: 'kanban', version: 1,
  tables: { tasks: domainTable<KanbanTaskId, KanbanTask>(kanbanTaskSchema) },
})
