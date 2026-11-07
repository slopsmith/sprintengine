/**
 * Every board on the machine: the machine-wide list, a board's global id, and
 * what a foreign ref may never do.
 *
 * On a real disk under a temporary folder, with the real catalogue and the real
 * service, because what is being proved is how the two agree about folders that
 * exist, folders that do not, and files that stay where they are.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, test } from 'vitest'

import { canvasBoardId } from '../../shared/canvas/paths'
import { emptyScene, serializeSceneFile } from '../../shared/canvas/scene-file'
import type { CanvasElement } from '../../shared/canvas/types'
import { deriveWorkspaceId } from '../mobile/control/workspace-id'
import { canvasBoardStoreDir } from './canvas-board-store'
import { createCanvasService } from './canvas-service'
import { CANVAS_STORE_MANIFEST, createCanvasStoreCatalogue } from './canvas-store-catalogue'
import { createNodeCanvasFs } from './canvas-node-fs'
import type { CanvasWorkerHost } from './canvas-worker-host'

const idleWorker: CanvasWorkerHost = {
  call: (async () => ({
    ok: false,
    error: { code: 'worker_unavailable', message: 'these cases need no worker' },
  })) as unknown as CanvasWorkerHost['call'],
  report: () => null,
  dispose: async () => {},
}

const rectangle = (id: string): CanvasElement => ({
  id,
  type: 'rectangle',
  version: 1,
  versionNonce: 1,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
})

let home: string
let userData: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'canvas-machine-'))
  userData = join(home, 'data')
  mkdirSync(userData)
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

/** A project folder on the temporary disk. */
function project(name: string): string {
  const folder = join(home, name)
  mkdirSync(folder, { recursive: true })
  return folder
}

/** A board on disk in a store, as an earlier run left it. */
function seedStoreBoard(folder: string, name: string, elements: CanvasElement[] = [rectangle('a')]): void {
  const store = canvasBoardStoreDir(userData, folder)
  mkdirSync(store, { recursive: true })
  writeFileSync(join(store, `${name}.excalidraw`), serializeSceneFile({ ...emptyScene(), elements }))
}

type Workspace = { id: string; folderPath: string | null; worktree?: { repoRoot: string } | null }

function harness(workspaces: Workspace[] = []) {
  const pushes: Array<{ subscriber: number; channel: string; payload: Record<string, unknown> }> = []
  const opened: unknown[] = []
  const catalogue = createCanvasStoreCatalogue({ userDataDir: userData, listWorkspaces: () => workspaces })
  const service = createCanvasService({
    fs: createNodeCanvasFs(),
    now: () => Date.now(),
    resolveWorkspaceRoot: (workspaceId) => workspaces.find((entry) => entry.id === workspaceId)?.folderPath ?? null,
    resolveBoardStore: (_workspaceId, root) => canvasBoardStoreDir(userData, root),
    storeCatalogue: catalogue,
    broadcast: (_channel, payload) => opened.push(payload),
    sendTo: (subscriber, channel, payload) =>
      pushes.push({ subscriber, channel, payload: payload as Record<string, unknown> }),
    worker: idleWorker,
    watch: () => ({ close() {} }),
  })
  return { service, catalogue, pushes, opened }
}

test('the list holds every store, each board with its project, and a store nobody remembers as deleted', async () => {
  const atlas = project('atlas')
  const beacon = project('beacon')
  const gone = join(home, 'gone')
  seedStoreBoard(atlas, 'architecture')
  seedStoreBoard(beacon, 'roadmap')
  seedStoreBoard(gone, 'orphan')

  const { service } = harness([
    { id: 'chat-atlas', folderPath: atlas },
    { id: 'chat-beacon', folderPath: beacon },
  ])
  const listed = await service.listAllBoards('chat-atlas')
  assert.ok(listed.ok)
  const byName = new Map(listed.value.boards.map((board) => [board.name, board]))
  assert.equal(byName.size, 3)
  assert.equal(byName.get('architecture')?.project, 'atlas')
  assert.equal(byName.get('architecture')?.here, true, 'a row of the asking chat says so')
  assert.equal(byName.get('roadmap')?.project, 'beacon')
  assert.equal(byName.get('roadmap')?.here, false)
  assert.equal(byName.get('roadmap')?.workspaceId, 'chat-beacon')
  assert.equal(byName.get('orphan')?.project, null, 'null is what a row draws as "Deleted project"')
  assert.equal(byName.get('orphan')?.workspaceId, null)
  assert.equal(JSON.stringify(listed.value).includes(home), false, 'a row carries no absolute path')
})

test('two stores with one board name are two rows with two ids', async () => {
  const atlas = project('atlas')
  const beacon = project('beacon')
  seedStoreBoard(atlas, 'arch', [rectangle('in-atlas')])
  seedStoreBoard(beacon, 'arch', [rectangle('in-beacon'), rectangle('second')])

  const { service } = harness([
    { id: 'chat-atlas', folderPath: atlas },
    { id: 'chat-beacon', folderPath: beacon },
  ])
  const listed = await service.listAllBoards()
  assert.ok(listed.ok)
  const rows = listed.value.boards.filter((board) => board.name === 'arch')
  assert.equal(rows.length, 2)
  assert.equal(new Set(rows.map((board) => board.id)).size, 2)

  // Each id reaches its own file.
  const atlasRow = rows.find((board) => board.project === 'atlas')!
  const beaconRow = rows.find((board) => board.project === 'beacon')!
  const fromAtlas = await service.readBoard({ workspaceId: 'chat-beacon', path: atlasRow.path, store: atlasRow.store })
  const fromBeacon = await service.readBoard({
    workspaceId: 'chat-atlas',
    path: beaconRow.path,
    store: beaconRow.store,
  })
  assert.ok(fromAtlas.ok && fromBeacon.ok)
  assert.deepEqual(
    fromAtlas.value.elements.map((element) => element.id),
    ['in-atlas'],
  )
  assert.equal(fromBeacon.value.elements.length, 2)
})

test('a known project lists its diagrams folder, once, from its worktrees too; deeper folders are not walked', async () => {
  const atlas = project('atlas')
  const worktree = project('atlas-wt/one')
  mkdirSync(join(atlas, 'diagrams'))
  mkdirSync(join(atlas, 'docs/deep'), { recursive: true })
  const scene = serializeSceneFile({ ...emptyScene(), elements: [rectangle('a')] })
  writeFileSync(join(atlas, 'diagrams', 'legacy.excalidraw'), scene)
  writeFileSync(join(atlas, 'docs/deep', 'unscanned.excalidraw'), scene)

  const { service } = harness([{ id: 'wt-chat', folderPath: worktree, worktree: { repoRoot: atlas } }])
  const listed = await service.listAllBoards()
  assert.ok(listed.ok)
  assert.deepEqual(
    listed.value.boards.map((board) => [board.path, board.project]),
    [['diagrams/legacy.excalidraw', 'atlas']],
  )
  const row = listed.value.boards[0]
  assert.equal(row.id, canvasBoardId(deriveWorkspaceId(atlas), 'diagrams/legacy.excalidraw'))

  const opened = await service.readBoard({ workspaceId: 'wt-chat', path: row.path, store: row.store })
  assert.ok(opened.ok, 'a project file opens by its id as a store board does')
})

test('a foreign ref is never created, whoever asks and however', async () => {
  const atlas = project('atlas')
  const beacon = project('beacon')
  seedStoreBoard(beacon, 'real')
  const store = deriveWorkspaceId(beacon)
  const storeDir = canvasBoardStoreDir(userData, beacon)
  const { service } = harness([
    { id: 'chat-atlas', folderPath: atlas },
    { id: 'chat-beacon', folderPath: beacon },
  ])
  const ref = { workspaceId: 'chat-atlas', path: 'unknown.excalidraw', store }

  const read = await service.readBoard(ref, { create: true })
  assert.equal(read.ok, false)
  assert.equal(!read.ok && read.error.code, 'not_found')
  assert.match(!read.ok ? read.error.message : '', /never created/)

  const opened = await service.openBoard(ref, { create: true, subscriberId: 1 })
  assert.equal(opened.ok, false)

  const committed = await service.commitScene(
    { ...ref, baseRevision: 0, elements: [rectangle('a')], appState: {}, files: {} },
    1,
  )
  assert.equal(committed.ok, false)

  const edited = await service.edit(ref, { create: [] }, { kind: 'human' })
  assert.equal(edited.ok, false)

  assert.equal(existsSync(join(storeDir, 'unknown.excalidraw')), false)
  // A bad store is refused as a shape, before any path is built from it.
  const bad = await service.readBoard({ workspaceId: 'chat-atlas', path: 'x.excalidraw', store: '../../etc' })
  assert.equal(!bad.ok && bad.error.code, 'invalid_path')
})

test('an orphaned store opens and saves in place, by id', async () => {
  const gone = join(home, 'gone')
  seedStoreBoard(gone, 'orphan')
  const atlas = project('atlas')
  const { service } = harness([{ id: 'chat-atlas', folderPath: atlas }])
  const store = deriveWorkspaceId(gone)
  const ref = { workspaceId: 'chat-atlas', path: 'orphan.excalidraw', store }

  const opened = await service.openBoard(ref, { create: false, subscriberId: 1 })
  assert.ok(opened.ok)
  const committed = await service.commitScene(
    { ...ref, baseRevision: 0, elements: [rectangle('a'), rectangle('b')], appState: {}, files: {} },
    1,
  )
  assert.ok(committed.ok)
  const text = readFileSync(join(canvasBoardStoreDir(userData, gone), 'orphan.excalidraw'), 'utf8')
  assert.match(text, /"b"/)
  await service.dispose()
})

test('a board is one entry by its file: two chats on it get pushes under their own refs', async () => {
  const atlas = project('atlas')
  const beacon = project('beacon')
  seedStoreBoard(atlas, 'arch')
  const store = deriveWorkspaceId(atlas)
  const { service, pushes } = harness([
    { id: 'chat-atlas', folderPath: atlas },
    { id: 'chat-beacon', folderPath: beacon },
  ])
  const own = { workspaceId: 'chat-atlas', path: 'arch.excalidraw' }
  const foreign = { workspaceId: 'chat-beacon', path: 'arch.excalidraw', store }

  // One window holding both tabs: each is its own subscription.
  assert.ok((await service.openBoard(own, { create: false, subscriberId: 7 })).ok)
  assert.ok((await service.openBoard(foreign, { create: false, subscriberId: 7 })).ok)

  const committed = await service.commitScene(
    { ...own, baseRevision: 0, elements: [rectangle('a'), rectangle('b')], appState: {}, files: {} },
    7,
  )
  assert.ok(committed.ok)
  const scenes = pushes.filter((push) => push.channel === 'canvas:scene')
  assert.equal(scenes.length, 1, 'the tab that drew is spared its echo; the other tab in its window is not')
  assert.equal(scenes[0].payload.workspaceId, 'chat-beacon')
  assert.equal(scenes[0].payload.store, store)

  // Both refs read one state, so a write through either is seen by the other.
  const read = await service.readBoard(foreign)
  assert.ok(read.ok)
  assert.equal(read.value.elements.length, 2)

  service.closeBoard(foreign, 7)
  pushes.length = 0
  await service.commitScene({ ...own, baseRevision: 1, elements: [rectangle('a')], appState: {}, files: {} }, 7)
  assert.equal(pushes.filter((push) => push.channel === 'canvas:scene').length, 0)
  await service.dispose()
})

test('requestOpen answers for the asking workspace, and carries the store', async () => {
  const atlas = project('atlas')
  const beacon = project('beacon')
  seedStoreBoard(atlas, 'arch')
  const store = deriveWorkspaceId(atlas)
  const { service, opened } = harness([
    { id: 'chat-atlas', folderPath: atlas },
    { id: 'chat-beacon', folderPath: beacon },
  ])
  const foreign = { workspaceId: 'chat-beacon', path: 'arch.excalidraw', store }
  // Another chat holding the board open says nothing about this chat's window.
  assert.ok((await service.openBoard({ workspaceId: 'chat-atlas', path: 'arch.excalidraw' }, { subscriberId: 1 })).ok)
  const asked = service.requestOpen(foreign)
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(opened.at(-1), { workspaceId: 'chat-beacon', path: 'arch.excalidraw', store })
  assert.ok((await service.openBoard(foreign, { subscriberId: 2 })).ok, 'its tab opens')
  const answer = await asked
  assert.ok(answer.ok && answer.value.revealed)
  await service.dispose()
})

test('closing a board whose workspace has gone still lets go of it', async () => {
  const atlas = project('atlas')
  seedStoreBoard(atlas, 'arch')
  const workspaces: Workspace[] = [{ id: 'chat-atlas', folderPath: atlas }]
  const { service, pushes } = harness(workspaces)
  const ref = { workspaceId: 'chat-atlas', path: 'arch.excalidraw' }
  assert.ok((await service.openBoard(ref, { subscriberId: 3 })).ok)
  workspaces.length = 0
  service.closeBoard(ref, 3)
  pushes.length = 0
  const id = { workspaceId: 'other', path: 'arch.excalidraw', store: deriveWorkspaceId(atlas) }
  await service.commitScene({ ...id, baseRevision: 0, elements: [rectangle('z')], appState: {}, files: {} }, 9)
  assert.equal(pushes.length, 0, 'nobody is still subscribed')
  await service.dispose()
})

test('a store says whose it is: written with its first board, backfilled by a listing, and what names it later', async () => {
  const atlas = project('atlas')
  const beacon = project('beacon')
  seedStoreBoard(beacon, 'old')
  const workspaces: Workspace[] = [
    { id: 'chat-atlas', folderPath: atlas },
    { id: 'chat-beacon', folderPath: beacon },
  ]
  const { service } = harness(workspaces)

  // A new board writes it.
  const made = await service.readBoard({ workspaceId: 'chat-atlas', path: 'new.excalidraw' }, { create: true })
  assert.ok(made.ok)
  assert.equal(made.value.id, canvasBoardId(deriveWorkspaceId(atlas), 'new.excalidraw'))
  await new Promise((resolve) => setTimeout(resolve, 20))
  const manifest = JSON.parse(readFileSync(join(canvasBoardStoreDir(userData, atlas), CANVAS_STORE_MANIFEST), 'utf8'))
  assert.equal(manifest.folderPath, atlas)
  assert.equal(manifest.project, 'atlas')

  // A listing backfills a store from before manifests, and the manifest is no board.
  const listed = await service.listAllBoards()
  assert.ok(listed.ok)
  assert.equal(listed.value.boards.length, 2)
  assert.equal(existsSync(join(canvasBoardStoreDir(userData, beacon), CANVAS_STORE_MANIFEST)), true)

  // Once the project's records are gone its store still knows what it was.
  workspaces.length = 0
  const after = harness(workspaces)
  const later = await after.service.listAllBoards()
  assert.ok(later.ok)
  assert.deepEqual(new Set(later.value.boards.map((board) => board.project)), new Set(['atlas', 'beacon']))
  await service.dispose()
})

test('the store key function is untouched: an existing store keeps its folder name', () => {
  // Spelled out, not derived: a change of hash here orphans every board on every
  // machine, and nothing else would notice.
  const folder = resolve('/Users/dev/project')
  const expected = `ws_${createHash('sha256').update(folder).digest('hex').slice(0, 24)}`
  assert.equal(deriveWorkspaceId(folder), expected)
})
