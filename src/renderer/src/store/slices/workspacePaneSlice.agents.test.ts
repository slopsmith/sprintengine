import assert from 'node:assert/strict'
import { test } from 'vitest'
import { STATIC_PANE_KINDS } from '../../components/workspace/pane/paneKinds'
import { normalizeWorkspacePaneState } from './workspacePaneSlice'

// A chat's subagents are on the right-hand panel now, so the tab that listed
// them is gone. An older profile still has it saved.

test('no pane kind lists subagents: the "+" menu offers no such tab', () => {
  assert.equal(
    STATIC_PANE_KINDS.some((definition) => (definition.kind as string) === 'agents'),
    false,
  )
})

test('a saved agents tab is dropped on restore, and the pane opens on what is left', () => {
  const normalized = normalizeWorkspacePaneState({
    open: true,
    activeTabId: 'old-agents',
    tabs: [
      { id: 'files', kind: 'files' },
      { id: 'old-agents', kind: 'agents' },
    ],
  })
  assert.deepEqual(normalized?.tabs, [{ id: 'files', kind: 'files' }])
  assert.notEqual(normalized?.activeTabId, 'old-agents')
})

test('a pane that held only an agents tab restores with nothing in it, and no dangling front tab', () => {
  const normalized = normalizeWorkspacePaneState({
    open: true,
    activeTabId: 'old-agents',
    tabs: [{ id: 'old-agents', kind: 'agents', poppedOut: 'window-1' }],
  })
  assert.deepEqual(normalized?.tabs ?? [], [])
  assert.notEqual(normalized?.activeTabId, 'old-agents')
})
