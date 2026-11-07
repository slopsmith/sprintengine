import { afterEach, expect, test, vi } from 'vitest'

import type { Workspace } from '../../../../types/workspace'

const state = vi.hoisted(() => ({
  workspaces: [] as Array<Pick<Workspace, 'id' | 'remoteOrigin'>>,
  openPaneTab: vi.fn(),
  setActiveWorkspace: vi.fn(),
  addWorkspace: vi.fn(() => 'local-chat'),
}))

vi.mock('../../../../store/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => state, subscribe: () => () => {} },
}))

const { canvasBoardSourceOf, continueBoardInNewChat, listCanvasBoards } = await import('./canvasBoardSource')

const STORE = `ws_${'a'.repeat(24)}`
const ID = `canvas://${STORE}/fleet.excalidraw`
const origin = {
  connectionId: 'conn-1',
  machineName: 'mac-mini',
  workspaceId: 'far-chat',
  workspaceName: 'harbor',
  workspaceRoot: null,
}
const paired = {
  kind: 'paired',
  connectionId: 'conn-1',
  machineName: 'mac-mini',
  remoteWorkspaceId: 'far-chat',
} as const
const board = {
  id: ID,
  path: 'fleet.excalidraw',
  name: 'fleet',
  elementCount: 1,
  modifiedAt: 1,
  store: STORE,
  project: 'harbor',
  showsProject: true,
  workspaceId: 'far-project',
}

function api(members: Record<string, unknown>): void {
  vi.stubGlobal('window', { api: members })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  state.workspaces = []
})

test('a chat with a remote origin reads its boards from that machine', async () => {
  expect(canvasBoardSourceOf({ remoteOrigin: origin })).toEqual(paired)
  expect(canvasBoardSourceOf({ remoteOrigin: null })).toEqual({ kind: 'here' })
  const meshCanvasBoards = vi.fn(async () => ({
    ok: true,
    allBoards: true,
    note: null,
    boards: [{ ...board, here: false }],
  }))
  api({ meshCanvasBoards })
  const listed = await listCanvasBoards(paired, 'local-chat', 'all')
  expect(meshCanvasBoards).toHaveBeenCalledWith({ connectionId: 'conn-1', workspaceId: 'far-chat', scope: 'machine' })
  expect(listed.ok && listed.value.boards[0].store).toBe(STORE)
})

test("a row of the chat's own project opens without a store, and a foreign row with one", async () => {
  const row = { ...board, here: false }
  api({
    canvasListAllBoards: async () => ({
      ok: true,
      value: { note: null, boards: [row, { ...row, here: true, path: 'own.excalidraw' }] },
    }),
  })
  const listed = await listCanvasBoards({ kind: 'here' }, 'chat', 'all')
  expect(listed.ok && listed.value.boards.map((entry) => entry.store)).toEqual([STORE, null])
})

test('continuing on a paired machine starts the chat there, naming the board, with its tab open here', async () => {
  state.workspaces = [{ id: 'local-chat', remoteOrigin: origin }]
  const meshCreateConversation = vi.fn(async () => ({
    ok: true,
    workspaceId: 'new-far',
    agentId: 'agent-1',
    title: 'Chat',
  }))
  api({ meshCreateConversation })
  const started = await continueBoardInNewChat(paired, 'local-chat', board)
  expect(started.ok).toBe(true)
  const asked = meshCreateConversation.mock.calls[0] as unknown as [{ workspaceId: string; prompt: string }]
  expect(asked[0].workspaceId).toBe('far-project')
  expect(asked[0].prompt).toContain(ID)
  expect(state.openPaneTab).toHaveBeenCalledWith('local-chat', {
    kind: 'canvas',
    canvas: { path: 'fleet.excalidraw', store: STORE },
  })
})

test("an older machine, with no id to give, is asked by the board's path", async () => {
  state.workspaces = [{ id: 'local-chat', remoteOrigin: origin }]
  const meshCreateConversation = vi.fn(async () => ({ ok: false, code: 'x', message: 'Refused there.' }))
  api({ meshCreateConversation })
  const started = await continueBoardInNewChat(paired, 'local-chat', { ...board, id: null, store: null })
  expect(started.ok).toBe(false)
  expect(!started.ok && started.error.message).toBe('Refused there.')
  const asked = meshCreateConversation.mock.calls[0] as unknown as [{ prompt: string }]
  expect(asked[0].prompt).toContain('fleet.excalidraw')
  expect(asked[0].prompt).not.toContain('canvas://')
})
