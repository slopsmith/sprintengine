import { expect, test } from 'vitest'
import type { TranscriptToolEntry } from './conversationProjection'
import { laneDelivery, laneSentOutcomes, type LaneDeliveryFacts } from './subagentDelivery'

const lane = (over: Partial<TranscriptToolEntry> = {}, agent: object = {}): TranscriptToolEntry => ({
  kind: 'tool',
  id: 'toolu_1',
  turnId: 't',
  name: 'Agent',
  status: 'done',
  subagentLane: true,
  agent: { state: 'completed', taskId: 'a1', ...agent },
  ...over,
})
const facts: LaneDeliveryFacts = {
  operate: true,
  providerRelays: true,
  transportRelays: true,
  harnessName: 'Claude Code',
}

test('a running agent and a finished one take a message: both were proven with the real SDK', () => {
  expect(laneDelivery(lane({ status: 'running' }, { state: 'running' }), facts)).toEqual({ kind: 'box' })
  expect(laneDelivery(lane(), facts)).toEqual({ kind: 'box' })
})

test.each([
  ['a stopped agent, which the CLI refuses', lane({ outputStatus: 'stopped' }, { state: 'stopped' }), 'stopped'],
  ['a failed agent, which nothing proved', lane({ outputStatus: 'error' }, { state: 'failed' }), 'failed'],
  ['one whose end was never recorded', lane({}, { state: 'unknown' }), 'never recorded'],
  ['one the harness says cannot go on', lane({}, { canContinue: false }), 'cannot be continued'],
  ['one with no address', lane({}, { taskId: undefined }), 'no way to reach'],
  ['a declined one', lane({ outputStatus: 'declined' }), 'declined'],
])('%s gets the bar', (_name, entry, words) => {
  const delivery = laneDelivery(entry, facts)
  expect(delivery.kind).toBe('bar')
  expect(delivery.kind === 'bar' && delivery.why).toContain(words)
})

test('a harness with no relay gets the bar, in its own name', () => {
  const delivery = laneDelivery(lane(), { ...facts, providerRelays: false, harnessName: 'Codex' })
  expect(delivery).toEqual({ kind: 'bar', why: 'Codex has no way to pass a message to a subagent.' })
})

test('a paired machine without the capability gets the bar, and it is named', () => {
  const delivery = laneDelivery(lane(), { ...facts, transportRelays: false, machineName: 'mac-mini' })
  expect(delivery.kind === 'bar' && delivery.why).toContain('mac-mini needs updating')
})

test('a chat that has not said what it can do gets the bar, and is not called incapable', () => {
  const delivery = laneDelivery(lane(), { ...facts, providerRelays: undefined })
  expect(delivery.kind === 'bar' && delivery.why).toContain('at rest')
})

test('a pairing that may only follow gets the bar', () => {
  expect(laneDelivery(lane(), { ...facts, operate: false }).kind).toBe('bar')
})

test('a message reads as passed on until the parent’s call says it was refused', () => {
  const sent = lane({
    sent: [
      { at: 10, text: 'one' },
      { at: 20, text: 'two' },
    ],
  })
  const call = (startedAt: number, output: string): TranscriptToolEntry => ({
    kind: 'tool',
    id: `call-${startedAt}`,
    turnId: 't',
    name: 'SendMessage',
    status: 'done',
    startedAt,
    input: { to: 'a1' },
    output,
  })
  const outcomes = laneSentOutcomes(sent, [
    call(11, '{"success":true}'),
    call(21, '{"success":false,"message":"It was stopped."}'),
  ])
  expect(outcomes.get(10)).toEqual({ state: 'passed' })
  expect(outcomes.get(20)).toEqual({ state: 'refused', why: 'It was stopped.' })
})
