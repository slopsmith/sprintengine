import { useEffect, useSyncExternalStore } from 'react'

import type { SubagentFamily } from './subagentFamily'

// The family of the chat each tab is viewing, for the right-hand panel, which
// stands in the pane column, outside every chat's context. `SubagentChatHost`
// publishes, for a chat here and a chat on a paired machine alike, keyed by the
// chat the tab holds, so the panel cannot tell where a chat runs or how its
// children were found. `chatPanelStore` is the pattern, and holds what a chat
// says about itself; this holds who it is related to.
//
// A family is read from the chat's transcript, which costs a chat something on
// every streamed token, so it is read only while a panel shows it: the panel
// says so (`useShowSubagentFamily`), and the host rests until then.

const NONE: SubagentFamily = {
  parent: null,
  lane: null,
  children: [],
  hasMore: false,
  loadingEarlier: false,
  loadEarlier: () => undefined,
}
const published = new Map<string, SubagentFamily>()
const listeners = new Set<() => void>()
const keyOf = (workspaceId: string, rootAgentId: string) => `${workspaceId}\0${rootAgentId}`

export function publishSubagentFamily(workspaceId: string, rootAgentId: string, family: SubagentFamily | null): void {
  const key = keyOf(workspaceId, rootAgentId)
  if (family === null) {
    if (!published.delete(key)) return
  } else {
    if (published.get(key) === family) return
    published.set(key, family)
  }
  for (const listener of listeners) listener()
}

const shown = new Map<string, number>()

function show(key: string): () => void {
  shown.set(key, (shown.get(key) ?? 0) + 1)
  for (const listener of listeners) listener()
  return () => {
    const left = (shown.get(key) ?? 1) - 1
    if (left > 0) shown.set(key, left)
    else shown.delete(key)
    for (const listener of listeners) listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSubagentFamily(workspaceId: string, rootAgentId: string | null): SubagentFamily {
  return useSyncExternalStore(subscribe, () =>
    rootAgentId ? (published.get(keyOf(workspaceId, rootAgentId)) ?? NONE) : NONE,
  )
}

/** The panel, for as long as it draws this tab's family. */
export function useShowSubagentFamily(workspaceId: string, rootAgentId: string | null): void {
  useEffect(() => (rootAgentId ? show(keyOf(workspaceId, rootAgentId)) : undefined), [workspaceId, rootAgentId])
}

/** Whether anything is drawing this tab's family. */
export function useSubagentFamilyShown(workspaceId: string, rootAgentId: string): boolean {
  return useSyncExternalStore(subscribe, () => shown.has(keyOf(workspaceId, rootAgentId)))
}

/** Called once per chat tab: says who the chat in view is related to, and takes it back when the tab goes. */
export function usePublishSubagentFamily(workspaceId: string, rootAgentId: string, family: SubagentFamily): void {
  useEffect(() => {
    publishSubagentFamily(workspaceId, rootAgentId, family)
  }, [workspaceId, rootAgentId, family])
  useEffect(() => () => publishSubagentFamily(workspaceId, rootAgentId, null), [workspaceId, rootAgentId])
}
