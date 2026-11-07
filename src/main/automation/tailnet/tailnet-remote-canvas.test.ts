import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

import { createTailnetMeshService } from './tailnet-mesh-service'
import { pairingUrl } from './tailnet-service'
import { TAILNET_IDENTITY_PATH, TAILNET_MCP_PATH, TAILNET_PAIR_PATH } from './tailnet-routes'

// A paired chat's boards are on the machine it runs on: the Canvas pane lists
// them through `canvas.list` there and shows one through `canvas.screenshot`. A
// machine without `canvas-machine-boards` answers for its project, as an older
// `canvas.list` always could, and the answer says so in words. These run over a
// stand-in peer on a local socket, not a second real Studio.

const ID = `canvas://ws_${'a'.repeat(24)}/arch.excalidraw`

type ToolAnswer = (args: Record<string, unknown>) => unknown

async function pairedMachine(capabilities: string[], answers: Record<string, ToolAnswer>) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
  const device = {
    deviceId: 'device-1',
    deviceName: 'mac-mini',
    scopes: ['workspace:read', 'workspace:operate', 'conversation:read', 'conversation:operate'],
    transportVersion: 2,
    capabilities,
  }
  const peer: Server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://peer.invalid').pathname
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    request.on('end', () => {
      if (path === TAILNET_PAIR_PATH) return json(200, { ...device, deviceToken: 'device-token' })
      if (path === TAILNET_IDENTITY_PATH) return json(200, device)
      if (path === TAILNET_MCP_PATH) {
        const call = JSON.parse(body) as {
          id?: unknown
          params?: { name?: string; arguments?: Record<string, unknown> }
        }
        const tool = call.params?.name ?? ''
        const args = call.params?.arguments ?? {}
        calls.push({ tool, args })
        const answer = answers[tool]
        if (!answer) return json(200, { jsonrpc: '2.0', id: call.id, error: { message: `Unknown tool: ${tool}` } })
        return json(200, { jsonrpc: '2.0', id: call.id, result: answer(args) })
      }
      return json(404, { error: { code: 'not_found', message: `No tailnet gateway route for ${path}.` } })
    })
  })
  await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve))
  const port = (peer.address() as { port: number }).port
  const dir = mkdtempSync(join(tmpdir(), 'tailnet-remote-canvas-'))
  const mesh = createTailnetMeshService({
    resolveUserDataDir: () => dir,
    resolveDeviceName: () => 'dev-macbook-air',
    resolvePeerName: async () => null,
  })
  const paired = await mesh.pair({ pairingUrl: pairingUrl('127.0.0.1', port, 'pairing-token') })
  assert.ok(paired.ok, paired.ok ? '' : paired.message)
  await mesh.checkReachability(paired.connection.id)
  return {
    mesh,
    connectionId: paired.connection.id,
    calls,
    async close() {
      mesh.shutdown()
      await new Promise<void>((resolve) => peer.close(() => resolve()))
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const list = (boards: unknown[], note?: string) => () => ({ structuredContent: { boards, ...(note ? { note } : {}) } })

test('a machine with the capability lists all its boards, each with its project and id', async () => {
  const machine = await pairedMachine(['canvas-machine-boards'], {
    'canvas.list': list([
      {
        id: ID,
        path: 'arch.excalidraw',
        name: 'arch',
        project: 'atlas',
        here: false,
        workspaceId: 'ws-9',
        elementCount: 4,
        modifiedAt: '2026-11-01T10:00:00.000Z',
      },
      { id: `${ID}x`, path: 'gone.excalidraw', name: 'gone', project: null, here: false, workspaceId: null },
    ]),
  })
  try {
    const listed = await machine.mesh.canvasBoards({
      connectionId: machine.connectionId,
      workspaceId: 'ws-1',
      scope: 'machine',
    })
    assert.ok(listed.ok, listed.ok ? '' : listed.message)
    assert.equal(listed.allBoards, true)
    assert.equal(listed.note, null)
    assert.deepEqual(machine.calls[0].args, { workspaceId: 'ws-1', scope: 'machine' })
    assert.equal(listed.boards[0].id, ID)
    assert.equal(listed.boards[0].project, 'atlas')
    assert.equal(listed.boards[0].workspaceId, 'ws-9')
    assert.equal(listed.boards[1].project, null)
  } finally {
    await machine.close()
  }
})

test('an older machine is asked for its project alone, and the answer says so in words', async () => {
  const machine = await pairedMachine([], {
    'canvas.list': list([
      { path: 'arch.excalidraw', name: 'arch', elementCount: 2, modifiedAt: '2026-11-01T10:00:00.000Z' },
    ]),
  })
  try {
    const listed = await machine.mesh.canvasBoards({
      connectionId: machine.connectionId,
      workspaceId: 'ws-1',
      scope: 'machine',
    })
    assert.ok(listed.ok, listed.ok ? '' : listed.message)
    assert.equal(listed.allBoards, false)
    assert.deepEqual(machine.calls[0].args, { workspaceId: 'ws-1' }, 'no argument an older handler would refuse')
    assert.match(listed.note ?? '', /lists only this project's boards/)
    assert.match(listed.note ?? '', /Update SprintEngine Studio there/)
    assert.equal(listed.boards[0].id, null)
    assert.equal(listed.boards[0].workspaceId, 'ws-1')
  } finally {
    await machine.close()
  }
})

test('a machine offering no canvas tools says what to do, not "Unknown tool"', async () => {
  const machine = await pairedMachine(['canvas-machine-boards'], {})
  try {
    const listed = await machine.mesh.canvasBoards({ connectionId: machine.connectionId, workspaceId: 'ws-1' })
    assert.ok(!listed.ok)
    assert.match(listed.message, /not offering its boards/)
    assert.doesNotMatch(listed.message, /Unknown tool/)
  } finally {
    await machine.close()
  }
})

test('a board is shown by the picture in the tool result, named by its id', async () => {
  const machine = await pairedMachine(['canvas-machine-boards'], {
    'canvas.screenshot': () => ({
      structuredContent: { width: 800, height: 600, mimeType: 'image/png' },
      content: [
        { type: 'text', text: '{}' },
        { type: 'image', data: 'UE5H', mimeType: 'image/png' },
      ],
    }),
  })
  try {
    const shot = await machine.mesh.canvasScreenshot({
      connectionId: machine.connectionId,
      workspaceId: 'ws-1',
      board: ID,
      dark: true,
    })
    assert.ok(shot.ok, shot.ok ? '' : shot.message)
    assert.deepEqual(shot, { ok: true, mimeType: 'image/png', data: 'UE5H', width: 800, height: 600 })
    assert.equal(machine.calls[0].args.board, ID)
    assert.equal(machine.calls[0].args.dark, true)
  } finally {
    await machine.close()
  }
})

test("a refusal over there is passed on in that machine's words", async () => {
  const machine = await pairedMachine(['canvas-machine-boards'], {
    'canvas.screenshot': () => ({
      isError: true,
      structuredContent: {
        error: { code: 'invalid_scene', message: 'The board is empty; there is nothing to capture.' },
      },
    }),
  })
  try {
    const shot = await machine.mesh.canvasScreenshot({
      connectionId: machine.connectionId,
      workspaceId: 'ws-1',
      board: ID,
    })
    assert.ok(!shot.ok)
    assert.equal(shot.code, 'invalid_scene')
    assert.match(shot.message, /nothing to capture/)
  } finally {
    await machine.close()
  }
})
