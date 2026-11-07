import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'

import { useWorkspaceStore } from '../../../store/workspaceStore'
import { useConversationLinkContext } from './conversationLinks'

// What a chat's tab is showing in place of the chat: a stack of the subagents
// the person went into, the newest on top, keyed by the workspace and the chat
// the tab holds. Back pops one level. It is never a layout tab, which would make
// a subagent a line in the sidebar and survive a restart; nothing here is saved,
// and after a restart the tab opens on its chat.
//
// `chat` is a sub-agent Studio started, a conversation of its own. `lane` is an
// agent a chat's CLI spawned, which is a part of that chat's transcript: its
// owner is the chat holding it, which a stack entry below may be.

export type SubagentView =
  | { kind: 'chat'; agentId: string; label?: string }
  | { kind: 'lane'; ownerAgentId: string; laneId: string; label?: string }

/** What the person clicked: a lane is read from the chat it was clicked in. */
export type SubagentTarget =
  { kind: 'chat'; agentId: string; label?: string } | { kind: 'lane'; laneId: string; label?: string }

/** The chat a stack belongs to. */
export type SubagentStackScope = { workspaceId: string; rootAgentId: string }

const NO_VIEWS: readonly SubagentView[] = []
let stacks: ReadonlyMap<string, readonly SubagentView[]> = new Map()
const listeners = new Set<() => void>()

const stackKey = (workspaceId: string, rootAgentId: string) => `${workspaceId}\0${rootAgentId}`

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function write(workspaceId: string, rootAgentId: string, views: readonly SubagentView[]): void {
  const next = new Map(stacks)
  const key = stackKey(workspaceId, rootAgentId)
  if (views.length === 0) next.delete(key)
  else next.set(key, views)
  stacks = next
  for (const listener of listeners) listener()
}

function sameView(a: SubagentView, b: SubagentView): boolean {
  if (a.kind === 'chat') return b.kind === 'chat' && a.agentId === b.agentId
  return b.kind === 'lane' && a.ownerAgentId === b.ownerAgentId && a.laneId === b.laneId
}

export function readSubagentViews(workspaceId: string, rootAgentId: string): readonly SubagentView[] {
  return stacks.get(stackKey(workspaceId, rootAgentId)) ?? NO_VIEWS
}

export function useSubagentViews(workspaceId: string, rootAgentId: string): readonly SubagentView[] {
  const read = () => readSubagentViews(workspaceId, rootAgentId)
  return useSyncExternalStore(subscribe, read, read)
}

/** Go into a subagent, or back to it where it is already on the stack. */
export function pushSubagentView(workspaceId: string, rootAgentId: string, view: SubagentView): void {
  const views = readSubagentViews(workspaceId, rootAgentId)
  const at = views.findIndex((existing) => sameView(existing, view))
  write(workspaceId, rootAgentId, at >= 0 ? views.slice(0, at + 1) : [...views, view])
}

/** One level back: the view under the top, which is the chat itself at the bottom. */
export function popSubagentView(workspaceId: string, rootAgentId: string): void {
  write(workspaceId, rootAgentId, readSubagentViews(workspaceId, rootAgentId).slice(0, -1))
}

/** Back to `depth` views on the stack: none is the chat itself. */
export function popSubagentViewsTo(workspaceId: string, rootAgentId: string, depth: number): void {
  write(workspaceId, rootAgentId, readSubagentViews(workspaceId, rootAgentId).slice(0, Math.max(0, depth)))
}

/** The conversation a view reads from: a chat's own, or for a lane the chat holding it. */
export function subagentViewOwner(view: SubagentView): string {
  return view.kind === 'chat' ? view.agentId : view.ownerAgentId
}

/**
 * The chat a person is looking at where `rootAgentId` is the tab's: the
 * sub-agent on top of its stack, or the chat itself. A lane is not a chat of its
 * own, so with one on top it is the chat holding it.
 */
export function viewedChatOf(workspaceId: string, rootAgentId: string): string {
  const top = readSubagentViews(workspaceId, rootAgentId).at(-1)
  return top ? subagentViewOwner(top) : rootAgentId
}

/** For tests: forget every stack. */
export function resetSubagentViews(): void {
  stacks = new Map()
  for (const listener of listeners) listener()
}

const SubagentStackContext = createContext<SubagentStackScope | null>(null)
export const SubagentStackProvider = SubagentStackContext.Provider

/** The stack this view is drawn inside, where it is in a chat's tab. */
export function useSubagentStackScope(): SubagentStackScope | null {
  return useContext(SubagentStackContext)
}

/**
 * The list of a chat's subagents: the right-hand panel, on its menu, which
 * follows the agent in view. Every "See subagents" comes through here.
 */
export function openSubagentList(workspaceId: string): void {
  useWorkspaceStore.getState().showPaneMenu(workspaceId)
}

/**
 * Opens a subagent as a full chat in the main pane, from a row in a chat, in a
 * lane, or (with `scope`) from beside the tab. A lane is read from the chat the
 * row is in.
 */
export function useOpenSubagent(scope?: SubagentStackScope): ((target: SubagentTarget) => void) | null {
  const provided = useSubagentStackScope()
  const link = useConversationLinkContext()
  const stack = scope ?? provided
  const workspaceId = stack?.workspaceId
  const rootAgentId = stack?.rootAgentId
  const linkAgentId = link?.agentId
  return useMemo(() => {
    if (!workspaceId || !rootAgentId) return null
    return (target: SubagentTarget) => {
      pushSubagentView(
        workspaceId,
        rootAgentId,
        target.kind === 'chat'
          ? target
          : {
              kind: 'lane',
              ownerAgentId: linkAgentId ?? viewedChatOf(workspaceId, rootAgentId),
              laneId: target.laneId,
              ...(target.label ? { label: target.label } : {}),
            },
      )
    }
  }, [workspaceId, rootAgentId, linkAgentId])
}
