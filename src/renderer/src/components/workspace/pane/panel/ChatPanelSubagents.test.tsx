// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { ChatPanelSubagents } from './ChatPanelSubagents'

const lane = {
  kind: 'tool',
  id: 'lane-1',
  name: 'Agent',
  subagentLane: true,
  status: 'running',
  input: { description: 'Review the calendar', subagent_type: 'Design review' },
}

vi.mock('../../../panels/agentChat/chatSubagentsStore', () => ({
  useChatSubagents: () => [{ kind: 'lane', id: 'lane-1', lane, working: true }],
}))

let root: Root | null = null
let host: HTMLElement

function render(cli: 'claude-code' | null) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(<ChatPanelSubagents workspaceId="ws-panel" agentId="agent-1" cli={cli} />))
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
  render('claude-code')
  expect(host.querySelector('path[fill="#D97757"]')).not.toBeNull()
})

test('a lane of a chat whose harness is unknown keeps the generic glyph', () => {
  render(null)
  expect(host.querySelector('path[fill="#D97757"]')).toBeNull()
})
