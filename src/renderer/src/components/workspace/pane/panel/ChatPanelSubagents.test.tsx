// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { SubagentFamily, SubagentFamilyMember } from '../../../panels/agentChat/subagentFamily'
import { ChatPanelParentLink, ChatPanelSubagents, subagentsInOrder } from './ChatPanelSubagents'

const lane = {
  kind: 'tool',
  id: 'lane-1',
  name: 'Agent',
  subagentLane: true,
  status: 'running',
  input: { description: 'Review the calendar', subagent_type: 'Design review' },
} as never

const member = (over: Partial<SubagentFamilyMember> = {}): SubagentFamilyMember => ({
  key: 'lane:lane-1',
  kind: 'lane',
  name: 'Review the calendar',
  cli: 'claude-code',
  state: 'working',
  words: 'Working',
  open: vi.fn(),
  source: { kind: 'lane', lane },
  ...over,
})

const family = (over: Partial<SubagentFamily> = {}): SubagentFamily => ({
  parent: null,
  lane: null,
  children: [member()],
  hasMore: false,
  loadingEarlier: false,
  loadEarlier: vi.fn(),
  ...over,
})

const HARNESS_LOGO = 'path[fill="#D97757"]' // design-tokens-allow: the harness's own brand colour, as its logo draws it

let root: Root | null = null
let host: HTMLElement

function render(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(node))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host.remove()
})

// The panel stands outside the chat's conversation context, which is what a
// lane's glyph reads, so without the parent's harness every row fell back to
// the generic glyph while the same agent wore its logo in the transcript.
test("a lane wears its parent chat's harness logo, though the panel is outside the chat", () => {
  render(<ChatPanelSubagents family={family()} />)
  expect(host.querySelector(HARNESS_LOGO)).not.toBeNull()
})

test('a lane of a chat whose harness is unknown keeps the generic glyph', () => {
  render(<ChatPanelSubagents family={family({ children: [member({ cli: null })] })} />)
  expect(host.querySelector(HARNESS_LOGO)).toBeNull()
})

test('a row goes where the family says', () => {
  const open = vi.fn()
  render(<ChatPanelSubagents family={family({ children: [member({ open })] })} />)
  act(() => host.querySelector<HTMLElement>('[data-panel-row="action"]')!.click())
  expect(open).toHaveBeenCalledOnce()
})

test('no children and nothing unread: nothing at all', () => {
  render(<ChatPanelSubagents family={family({ children: [] })} />)
  expect(host.textContent).toBe('')
})

test('those at work or waiting come first, each group as it started', () => {
  const named = (name: string, state: SubagentFamilyMember['state']) => member({ key: name, name, state })
  const ordered = subagentsInOrder([
    named('finished', 'done'),
    named('at work', 'working'),
    named('failed', 'failed'),
    named('waiting', 'waiting'),
  ])
  expect(ordered.map((entry) => entry.name)).toEqual(['at work', 'waiting', 'finished', 'failed'])
})

test('the way back up names the main chat by what it goes by, and a parent agent by its name', () => {
  const open = vi.fn()
  render(<ChatPanelParentLink parent={{ name: 'Calendar', relation: 'Main chat', cli: 'claude-code', open }} />)
  expect(host.textContent).toBe('Main chatCalendar')
  act(() => host.querySelector<HTMLElement>('button')!.click())
  expect(open).toHaveBeenCalledOnce()
  act(() => root?.unmount())
  render(<ChatPanelParentLink parent={{ name: 'Find it', relation: 'Parent agent', cli: 'claude-code', open }} />)
  expect(host.textContent).toBe('Find itParent agent')
})
