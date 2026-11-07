import { expect, test } from 'vitest'
import type { TranscriptEntry, TranscriptToolEntry } from '../src/conversationProjection'
import { projectConversation } from '../src/conversationProjection'
import {
  childAgentLanes,
  collectAgentLanes,
  deriveConversationTimelineRows,
  directAgentLanes,
  laneTranscript,
} from '../src/conversationTimeline'

const step = (id: string, startedAt: number, extra: Partial<TranscriptToolEntry> = {}): TranscriptToolEntry => ({
  kind: 'tool',
  id,
  turnId: 'parent-turn',
  name: 'Read',
  status: 'done',
  startedAt,
  ...extra,
})
const lane = (extra: Partial<TranscriptToolEntry> = {}): TranscriptToolEntry =>
  step('toolu_lane', 1, {
    name: 'Agent',
    subagentLane: true,
    input: { prompt: 'Map the suites', description: 'Map' },
    output: 'Six suites.',
    agent: { state: 'completed', taskId: 'a1', description: 'Map' },
    children: [step('one', 10), step('two', 20)],
    messages: [
      { at: 15, text: 'Looking further.' },
      { at: 30, text: 'Six suites.' },
    ],
    ...extra,
  })

const of = <K extends TranscriptEntry['kind']>(entries: TranscriptEntry[], kind: K) =>
  entries.filter((entry): entry is Extract<TranscriptEntry, { kind: K }> => entry.kind === kind)

test('a lane reads as its prompt, then a turn of its steps and its report', () => {
  const entries = laneTranscript(lane())
  expect(of(entries, 'user').map((entry) => entry.text)).toEqual(['Map the suites'])
  const [turn] = of(entries, 'assistant')
  expect(turn).toMatchObject({ status: 'complete', text: 'Six suites.' })
  expect(turn!.intermediateText).toMatchObject([{ text: 'Looking further.', beforeToolUseId: 'two' }])
})

test('each step is stamped with the turn, or the timeline would not group it', () => {
  const entries = laneTranscript(lane())
  const [turn] = of(entries, 'assistant')
  expect(of(entries, 'tool').every((tool) => tool.turnId === turn!.turnId)).toBe(true)
  const rows = deriveConversationTimelineRows(entries, false)
  expect(rows.find((row) => row.kind === 'assistant')).toMatchObject({ tools: [{ id: 'one' }, { id: 'two' }] })
})

test('the report is not said twice, and it does not change the lane it was read from', () => {
  const source = lane()
  const copy = structuredClone(source)
  expect(of(laneTranscript(source), 'assistant')[0]!.text).toBe('Six suites.')
  expect(source).toEqual(copy)
})

test('what the person wrote sits between the turns, with what the agent did after it', () => {
  const entries = laneTranscript(lane({ sent: [{ at: 18, text: 'Check the e2e too' }] }))
  expect(of(entries, 'user').map((entry) => entry.text)).toEqual(['Map the suites', 'Check the e2e too'])
  const turns = of(entries, 'assistant')
  expect(turns).toHaveLength(2)
  const tools = of(entries, 'tool')
  expect(tools.find((tool) => tool.id === 'one')!.turnId).toBe(turns[0]!.turnId)
  expect(tools.find((tool) => tool.id === 'two')!.turnId).toBe(turns[1]!.turnId)
})

test('a running lane streams; a failed one says why; a stopped one reads as interrupted', () => {
  expect(of(laneTranscript(lane({ status: 'running', output: undefined })), 'assistant')[0]!.status).toBe('streaming')
  const failed = lane({ agent: { state: 'failed', error: 'It ran out of room.' }, output: undefined })
  expect(of(laneTranscript(failed), 'assistant')[0]).toMatchObject({
    status: 'failed',
    failureDetail: 'It ran out of room.',
  })
  const stopped = lane({ agent: { state: 'stopped' }, output: undefined })
  expect(of(laneTranscript(stopped), 'assistant')[0]!.status).toBe('interrupted')
})

test('a prompt too long to keep falls back to the words the agent reported', () => {
  const entries = laneTranscript(lane({ input: {}, inputTruncated: true }))
  expect(of(entries, 'user')[0]!.text).toBe('Map')
})

test('a nested lane stays a lane in its parent’s transcript, and only direct children are named', () => {
  const inner = step('inner', 12, { name: 'Agent', subagentLane: true, agent: { state: 'running', taskId: 'a2' } })
  const outer = lane({ children: [step('one', 10), inner] })
  const entries: TranscriptEntry[] = [outer]
  expect(directAgentLanes(entries).map((entry) => entry.id)).toEqual(['toolu_lane'])
  expect(childAgentLanes(outer).map((entry) => entry.id)).toEqual(['inner'])
  expect(collectAgentLanes(entries).map((entry) => entry.id)).toEqual(['toolu_lane', 'inner'])
  expect(of(laneTranscript(outer), 'tool').find((tool) => tool.id === 'inner')?.subagentLane).toBe(true)
})

test('a person’s message recorded on the chat lands on its lane, and on the Studio notice', () => {
  const base = { workspaceId: 'w', sessionId: 's', agentId: 'a', providerId: 'p', modelId: 'm' }
  let id = 0
  const at = (type: string, createdAt: number, payload: Record<string, unknown>) =>
    ({ ...base, id: `e${(id += 1)}`, type, createdAt, payload }) as never
  const { entries } = projectConversation([
    at('user_message', 1, { turnId: 't1', text: 'Start' }),
    at('turn_started', 2, { turnId: 't1' }),
    at('tool_started', 3, { turnId: 't1', toolUseId: 'lane', name: 'Agent', subagentLane: true }),
    at('user_message', 4, {
      turnId: 't2',
      text: 'Pass this on',
      origin: { kind: 'studio', reason: 'agent-message' },
      subagentMessage: { toolUseId: 'lane', text: 'Check the e2e too' },
    }),
  ])
  expect(collectAgentLanes(entries)[0]!.sent).toEqual([{ at: 4, text: 'Check the e2e too' }])
  const notice = of(entries, 'user').at(-1)!
  expect(notice.origin).toEqual({ kind: 'studio', reason: 'agent-message' })
  expect(notice.subagentMessage).toEqual({ toolUseId: 'lane', text: 'Check the e2e too' })
})
