import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { subagentEnded } from '../../../../../shared/conversation/subagentStatus'
import { studioSubagentsOf, useStudioSubagents, type StudioSubagent } from '../../workspace/pane/agents/studioSubagents'
import type { TranscriptEntry, TranscriptToolEntry } from './conversationProjection'
import { useRemoteChat } from './remoteChatRegistry'

// The agents a chat sent off to work, for the right-hand panel's Subagents
// section: the seam between who they are and how they are opened. The chat
// publishes what it knows; the section reads this and nothing else, so it needs
// no session of its own and cannot tell which machine the chat is on.
//
// Only the chat's own children: an agent one of them spawned is that agent's
// to list.

export type ChatSubagent =
  | { kind: 'lane'; id: string; lane: TranscriptToolEntry; working: boolean }
  | { kind: 'studio'; id: string; subagent: StudioSubagent; working: boolean }

/** The lanes this transcript spawned itself: not the ones nested inside another lane. */
export function ownAgentLanes(entries: readonly TranscriptEntry[]): TranscriptToolEntry[] {
  const lanes: TranscriptToolEntry[] = []
  const walk = (tool: TranscriptToolEntry) => {
    if (tool.subagentLane) {
      lanes.push(tool)
      return
    }
    for (const child of tool.children ?? []) walk(child)
  }
  for (const entry of entries) if (entry.kind === 'tool') walk(entry)
  return lanes
}

/** The ones still working first, each group in the order they started. */
export function chatSubagentsOf(
  lanes: readonly TranscriptToolEntry[],
  studio: readonly StudioSubagent[],
): ChatSubagent[] {
  const all: ChatSubagent[] = [
    ...lanes.map((lane): ChatSubagent => ({ kind: 'lane', id: lane.id, lane, working: lane.status === 'running' })),
    ...studio.map((subagent): ChatSubagent => ({
      kind: 'studio',
      id: subagent.id,
      subagent,
      working: !subagentEnded(subagent.status),
    })),
  ]
  return [...all.filter((entry) => entry.working), ...all.filter((entry) => !entry.working)]
}

const published = new Map<string, readonly ChatSubagent[]>()
const listeners = new Set<() => void>()
const keyOf = (workspaceId: string, agentId: string) => `${workspaceId}\0${agentId}`
const NONE: readonly ChatSubagent[] = []

function publish(workspaceId: string, agentId: string, subagents: readonly ChatSubagent[]): void {
  const key = keyOf(workspaceId, agentId)
  const current = published.get(key) ?? NONE
  if (current === subagents || (current.length === 0 && subagents.length === 0)) return
  if (subagents.length === 0) published.delete(key)
  else published.set(key, subagents)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useChatSubagents(workspaceId: string | null, agentId: string | null): readonly ChatSubagent[] {
  return useSyncExternalStore(subscribe, () =>
    workspaceId && agentId ? (published.get(keyOf(workspaceId, agentId)) ?? NONE) : NONE,
  )
}

/**
 * Called once per chat view. What changes a row is how the agent stands, not
 * each step it takes, so a streamed token rebuilds nothing here.
 */
export function usePublishChatSubagents(
  workspaceId: string,
  agentId: string,
  entries: readonly TranscriptEntry[],
): void {
  const lanes = useMemo(() => ownAgentLanes(entries), [entries])
  const laneKey = lanes
    .map((lane) => `${lane.id}:${lane.status}:${lane.outputStatus ?? ''}:${lane.completedAt ?? ''}`)
    .join('\n')
  // A chat on a paired machine has no records here: its machine names them.
  const hereStudio = useStudioSubagents(workspaceId, agentId)
  const named = useRemoteChat(workspaceId, agentId)?.subagents
  const studio = useMemo(() => (named ? studioSubagentsOf(named) : hereStudio), [named, hereStudio])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `laneKey` is what about the lanes a row shows
  const subagents = useMemo(() => chatSubagentsOf(lanes, studio), [laneKey, studio])
  useEffect(() => {
    publish(workspaceId, agentId, subagents)
  }, [workspaceId, agentId, subagents])
  useEffect(() => () => publish(workspaceId, agentId, NONE), [workspaceId, agentId])
}
