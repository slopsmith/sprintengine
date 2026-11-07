import { expect, test, vi } from 'vitest'
import type { TranscriptEntry, TranscriptToolEntry } from './conversationProjection'
import type { StudioSubagent } from './chatSubagents'
import { subagentFamilyOf } from './subagentFamily'
import type { SubagentView } from './subagentViewStack'

const lane = (id: string, children: TranscriptToolEntry[] = []): TranscriptToolEntry => ({
  kind: 'tool',
  id,
  turnId: 't',
  name: 'Agent',
  status: 'done',
  subagentLane: true,
  input: { description: id },
  agent: { state: 'completed', taskId: `task-${id}` },
  children,
})
const chat: StudioSubagent = {
  id: 'sub-1',
  name: 'Design review',
  cli: 'cursor',
  readOnly: false,
  status: 'working',
  task: 'Review',
  startedAt: 1,
  endedAt: null,
  error: null,
}
const family = (views: SubagentView[], entries: TranscriptEntry[], chats: StudioSubagent[] = []) => {
  const push = vi.fn()
  const pop = vi.fn()
  return {
    push,
    pop,
    result: subagentFamilyOf({
      views,
      rootName: 'Calendar screen rebuild',
      rootCli: 'claude-code',
      viewedCli: 'claude-code',
      nameOfChat: (id) => (id === 'sub-1' ? 'Design review' : undefined),
      chats,
      entries,
      push,
      pop,
      hasMore: false,
      loadEarlier: () => undefined,
    }),
  }
}

test('the chat itself has no parent, and its children are its own, not theirs', () => {
  const { result } = family([], [lane('outer', [lane('inner')])], [chat])
  expect(result.parent).toBeNull()
  expect(result.children.map((member) => member.name)).toEqual(['Design review', 'outer'])
})

test('a child opens by being pushed, with its name, from the chat in view', () => {
  const { result, push } = family([], [lane('outer')])
  result.children[0]!.open()
  expect(push).toHaveBeenCalledWith({ kind: 'lane', ownerAgentId: '', laneId: 'outer', label: 'outer' })
})

test('from a lane, the parent is the main chat, and only that lane’s children are named', () => {
  const views: SubagentView[] = [{ kind: 'lane', ownerAgentId: 'root', laneId: 'outer' }]
  const { result, pop } = family(views, [lane('outer', [lane('inner', [lane('deeper')])])])
  expect(result.parent).toMatchObject({ name: 'Calendar screen rebuild', relation: 'Main chat', cli: 'claude-code' })
  expect(result.children.map((member) => member.name)).toEqual(['inner'])
  result.parent!.open()
  expect(pop).toHaveBeenCalledOnce()
})

test('two levels down, the parent is the agent between', () => {
  const views: SubagentView[] = [
    { kind: 'chat', agentId: 'sub-1' },
    { kind: 'lane', ownerAgentId: 'sub-1', laneId: 'outer' },
  ]
  expect(family(views, [lane('outer')]).result.parent).toMatchObject({
    name: 'Design review',
    relation: 'Parent agent',
  })
})

test('a child says how it stands in words', () => {
  const { result } = family([], [], [chat, { ...chat, id: 'sub-2', status: 'needs_input' }])
  expect(result.children.map((member) => [member.state, member.words])).toEqual([
    ['working', 'Working'],
    ['waiting', 'Waiting on you'],
  ])
})
