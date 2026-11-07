import assert from 'node:assert/strict'

import { test } from 'vitest'

import type { ConversationLaunchRequest } from '../conversation-launch-service'
import { continueCanvasBoardInNewChat, type CanvasBoardChatDeps } from './canvas-board-chat'

const ID = `canvas://ws_${'a'.repeat(24)}/arch.excalidraw`

function harness(folders: Record<string, string>, onDisk: string[]) {
  const launched: ConversationLaunchRequest[] = []
  const deps: CanvasBoardChatDeps = {
    folderOf: (workspaceId) => folders[workspaceId] ?? null,
    folderExists: async (folder) => onDisk.includes(folder),
    launch: async (request) => {
      launched.push(request)
      return {
        ok: true,
        workspaceId: 'new-chat',
        agentId: 'agent',
        name: 'Chat',
        cli: 'claude-code',
        providerId: 'claude',
        modelId: 'model',
        sessionId: 'session',
      }
    },
    newProjectlessFolder: async () => '/Users/dev/.sprintengine/chats/board',
  }
  return { deps, launched }
}

test('the chat starts beside the board, and its first message names the board by id', async () => {
  const { deps, launched } = harness({ board: '/Users/dev/atlas', asker: '/Users/dev/beacon' }, ['/Users/dev/atlas'])
  const started = await continueCanvasBoardInNewChat(deps, {
    workspaceId: 'asker',
    id: ID,
    name: 'arch',
    boardWorkspaceId: 'board',
  })
  assert.deepEqual(started, { ok: true, value: { workspaceId: 'new-chat', agentId: 'agent' } })
  assert.equal(launched[0].workspaceId, 'board')
  assert.equal(launched[0].newChat, true)
  assert.ok(launched[0].prompt?.includes(ID))
})

test('a board whose folder is gone is taken up from the chat that asked', async () => {
  const { deps, launched } = harness({ board: '/Users/dev/gone', asker: '/Users/dev/beacon' }, ['/Users/dev/beacon'])
  await continueCanvasBoardInNewChat(deps, { workspaceId: 'asker', id: ID, name: 'arch', boardWorkspaceId: 'board' })
  assert.equal(launched[0].workspaceId, 'asker')
})

test('with no folder left at all the chat starts under no project, and the board is not refused', async () => {
  const { deps, launched } = harness({}, [])
  const started = await continueCanvasBoardInNewChat(deps, { workspaceId: 'asker', id: ID, name: 'arch' })
  assert.equal(started.ok, true)
  assert.equal(launched[0].newChatIn?.folderPath, '/Users/dev/.sprintengine/chats/board')
})

test('a refused launch is said in its own words', async () => {
  const { deps } = harness({ asker: '/Users/dev/beacon' }, ['/Users/dev/beacon'])
  deps.launch = async () => ({ ok: false, code: 'no_cli', message: 'No agent CLI is installed.' })
  const started = await continueCanvasBoardInNewChat(deps, { workspaceId: 'asker', id: ID, name: 'arch' })
  assert.equal(!started.ok && started.error.message, 'No agent CLI is installed.')
})
