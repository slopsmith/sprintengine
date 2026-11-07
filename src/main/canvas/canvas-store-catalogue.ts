// What this machine's board stores are for: which project each one belongs to.
//
// A store's folder is named by a one-way hash of its project's folder
// (`canvasBoardStoreDir`), so a store cannot say whose it is. It can only be
// matched against the folders the app knows, and every chat keeps its record
// when it settles, so that covers most of them. What it cannot cover is a
// project nothing remembers any more, which is why a store now keeps a
// `store.json` beside its boards naming the folder and the project: a store
// made from here on stays attributable after its workspaces are gone. A store
// from before that, whose folder is unknown, is a "Deleted project". It keeps
// listing and opening all the same: nothing ever deletes a board.
//
// The answer is read fresh on every listing rather than kept in an index. The
// disk is one flat folder and a readdir of it is cheap, and an index would be
// one more thing to keep true when a project is removed.
//
// Only main ever sees these paths. A row leaves here with a project's name, and
// never with a folder (`workspace-id.ts` says why).

import { readFileSync } from 'node:fs'
import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { isCanvasStoreKey } from '../../shared/canvas/paths'
import { isMachinePath } from '../../shared/machine-paths'
import { PROJECTLESS_CHATS_LABEL, projectlessChatsRootOf } from '../../shared/projectless-chats'
import { isRecord } from '../../shared/records'
import { workspaceProjectRootOf } from '../../shared/worktree-paths'
import { deriveWorkspaceId } from '../mobile/control/workspace-id'
import { CANVAS_BOARD_STORE_DIR } from './canvas-board-store'
import type { CanvasStoreCatalogue, CanvasStoreRecord } from './canvas-service'

/** What a store says about itself. Read by this module, and by a person browsing the folder. */
export const CANVAS_STORE_MANIFEST = 'store.json'

type CanvasStoreManifest = { schemaVersion: 1; folderPath: string; project: string }

/** The fields of a workspace record this module reads. */
export type CanvasCatalogueWorkspace = {
  id: string
  folderPath?: string | null
  worktree?: { repoRoot?: string } | null
}

export type CanvasStoreCatalogueDeps = {
  userDataDir: string
  /** Every workspace record, settled chats included. Read on every call, never captured. */
  listWorkspaces: () => readonly CanvasCatalogueWorkspace[]
  log?: (message: string, details?: Record<string, unknown>) => void
}

/** What the app knows about one folder, from the workspaces in it. */
type KnownFolder = {
  folder: string
  project: string
  /** A workspace in this folder, or null for a project root only its worktrees name. */
  workspaceId: string | null
  /** The folder is a project's own, and not a worktree or a chat's folder under one. */
  isProjectRoot: boolean
}

function lastSegment(path: string): string {
  // `basename` of the platform this runs on is wrong for a folder on another:
  // an SSH machine's `ssh://…/app`, or a Windows path read on a test's posix.
  const trimmed = path.replace(/[\\/]+$/u, '')
  return basename(trimmed.replace(/\\/g, '/')) || trimmed
}

/** What a row calls a workspace's project: its folder's last name, as the sidebar's header does. */
function projectNameOf(record: CanvasCatalogueWorkspace): string {
  const folder = record.folderPath?.trim() ?? ''
  if (!record.worktree?.repoRoot && projectlessChatsRootOf(folder)) return PROJECTLESS_CHATS_LABEL
  return lastSegment(workspaceProjectRootOf(record) ?? folder)
}

function parseManifest(text: string): CanvasStoreManifest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed) || typeof parsed.folderPath !== 'string' || !parsed.folderPath) return null
  return {
    schemaVersion: 1,
    folderPath: parsed.folderPath,
    project: typeof parsed.project === 'string' && parsed.project ? parsed.project : lastSegment(parsed.folderPath),
  }
}

export function createCanvasStoreCatalogue(deps: CanvasStoreCatalogueDeps): CanvasStoreCatalogue {
  const root = join(deps.userDataDir, CANVAS_BOARD_STORE_DIR)
  const log = deps.log ?? (() => {})
  /** A folder's key, kept: `storeKeyOf` runs on every call that names a board. */
  const keys = new Map<string, string>()
  /** The stores whose manifest this run has already checked. Written once, not on every save. */
  const noted = new Set<string>()

  function storeKeyOf(folder: string): string {
    const known = keys.get(folder)
    if (known) return known
    const key = deriveWorkspaceId(folder)
    keys.set(folder, key)
    return key
  }

  function knownFolders(): Map<string, KnownFolder> {
    const known = new Map<string, KnownFolder>()
    const add = (folder: string, entry: Omit<KnownFolder, 'folder'>): void => {
      const key = storeKeyOf(folder)
      const held = known.get(key)
      if (!held) known.set(key, { folder, ...entry })
      else if (!held.workspaceId) held.workspaceId = entry.workspaceId
      if (held && entry.isProjectRoot) held.isProjectRoot = true
    }
    for (const record of deps.listWorkspaces()) {
      const folder = record.folderPath?.trim()
      if (!folder) continue
      const project = projectNameOf(record)
      const projectRoot = workspaceProjectRootOf(record)
      add(folder, { project, workspaceId: record.id, isProjectRoot: projectRoot === folder })
      // A worktree's own project: its `diagrams/` is scanned once, here, and
      // not again in every checkout that happens to carry a copy.
      if (projectRoot && projectRoot !== folder && !isProjectlessRoot(record)) {
        add(projectRoot, { project, workspaceId: null, isProjectRoot: true })
      }
    }
    return known
  }

  function isProjectlessRoot(record: CanvasCatalogueWorkspace): boolean {
    return !record.worktree?.repoRoot && projectlessChatsRootOf(record.folderPath) !== null
  }

  function readManifest(store: string): CanvasStoreManifest | null {
    try {
      // Synchronous, like the small manifest reads in workspace-store.ts: a
      // board is located synchronously, and this is one small file, read only
      // for a store no workspace answers for.
      return parseManifest(readFileSync(join(root, store, CANVAS_STORE_MANIFEST), 'utf8'))
    } catch {
      return null
    }
  }

  async function writeManifest(store: string, manifest: CanvasStoreManifest): Promise<void> {
    const directory = join(root, store)
    const file = join(directory, CANVAS_STORE_MANIFEST)
    const temp = `${file}.${process.pid}.tmp`
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      await rename(temp, file)
    } catch (error) {
      // Nothing depends on it today: a board is found with or without one.
      await unlink(temp).catch(() => undefined)
      noted.delete(store)
      log('A board store could not write what project it belongs to', {
        store,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Write the manifest of a store whose folder is known, once per run. */
  async function note(store: string, known: KnownFolder | undefined): Promise<void> {
    if (!known) return
    noted.add(store)
    const held = readManifest(store)
    if (held && held.folderPath === known.folder && held.project === known.project) return
    await writeManifest(store, { schemaVersion: 1, folderPath: known.folder, project: known.project })
  }

  return {
    storeKeyOf,

    storeDirectory: (store) => (isCanvasStoreKey(store) ? join(root, store) : null),

    projectFolder(store) {
      if (!isCanvasStoreKey(store)) return null
      return knownFolders().get(store)?.folder ?? readManifest(store)?.folderPath ?? null
    },

    noteBoardWritten(store) {
      if (!noted.has(store)) void note(store, knownFolders().get(store))
    },

    async list() {
      let names: string[] = []
      try {
        names = (await readdir(root, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && isCanvasStoreKey(entry.name))
          .map((entry) => entry.name)
      } catch {
        // No folder yet: nobody on this machine has drawn a board.
      }
      const known = knownFolders()
      const records: CanvasStoreRecord[] = []
      for (const store of names) {
        const folder = known.get(store)
        // The backfill: a store from before manifests, whose folder is known today.
        if (!noted.has(store)) await note(store, folder)
        const manifest = folder ? null : readManifest(store)
        records.push({
          store,
          directory: join(root, store),
          // Only a project's own folder: a worktree's `diagrams/` is its project's.
          projectFolder: null,
          project: folder?.project ?? manifest?.project ?? null,
          workspaceId: folder?.workspaceId ?? null,
        })
      }
      // A project with no store still has the boards it made before stores:
      // `diagrams/` and nowhere else, because walking hundreds of chat folders
      // is the one thing this listing cannot afford (a chat's own list walks
      // its own project in full).
      for (const [store, folder] of known) {
        if (!folder.isProjectRoot || isMachinePath(folder.folder)) continue
        const record = records.find((candidate) => candidate.store === store)
        if (record) record.projectFolder = folder.folder
        else
          records.push({
            store,
            directory: null,
            projectFolder: folder.folder,
            project: folder.project,
            workspaceId: folder.workspaceId,
          })
      }
      return records
    },
  }
}
