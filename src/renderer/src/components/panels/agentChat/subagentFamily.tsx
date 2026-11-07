import { useDeferredValue, useMemo, useRef, type JSX, type ReactNode } from 'react'
import { subagentEnded } from '../../../../../shared/conversation/subagentStatus'
import { cliForConversationProvider } from '../../../../../shared/conversation-harness'
import type { AgentCli } from '../../../types/workspace'
import { studioSubagentsOf, SubagentStatusWords, useStudioSubagents, type StudioSubagent } from './chatSubagents'
import { useChatSource, type ChatSource } from './chatSource'
import { projectConversation, type TranscriptEntry, type TranscriptToolEntry } from './conversationProjection'
import { childAgentLanes, collectAgentLanes, directAgentLanes } from './conversationTimeline'
import { ConversationTransportProvider } from './conversationTransport'
import { useChatViewActive } from './chatViewActivity'
import { laneAgentState, laneName, laneOutcomeWords, LaneStatus } from './subagentStatus'
import {
  popSubagentView,
  pushSubagentView,
  subagentViewOwner,
  useSubagentViews,
  type SubagentView,
} from './subagentViewStack'
import { useConversationSession } from './useConversationSession'
import { useThrottledValue } from './useThrottledValue'

// What sits beside a chat's tab needs of its family: for the chat being viewed,
// the way up to its parent and its direct children, and only those. A child's
// own children are read by going into it. This is the seam the right-hand panel
// reads; it draws nothing but a child's status words, which tick.

export type SubagentFamilyState = 'working' | 'waiting' | 'done' | 'failed' | 'stopped' | 'unknown'

export type SubagentFamilyMember = {
  /** Stable among its siblings. */
  key: string
  kind: 'chat' | 'lane'
  name: string
  /** The harness whose logo it wears. */
  cli: AgentCli | null
  state: SubagentFamilyState
  /** How it stands, in words, without a running clock; `SubagentFamilyStatus` adds that. */
  words: string
  /** Go into it, as a full chat in the main pane. */
  open(): void
  /** What `SubagentFamilyStatus` draws from. */
  source: { kind: 'chat'; subagent: StudioSubagent } | { kind: 'lane'; lane: TranscriptToolEntry }
}

export type SubagentFamilyParent = {
  name: string
  /** "Main chat" for the chat the tab holds, "Parent agent" for one between. */
  relation: string
  cli: AgentCli | null
  open(): void
}

export type SubagentFamily = {
  parent: SubagentFamilyParent | null
  children: readonly SubagentFamilyMember[]
  /** Older turns are not read yet, and may hold older children. */
  hasMore: boolean
  loadEarlier(): void
}

const NO_FAMILY: SubagentFamily = { parent: null, children: [], hasMore: false, loadEarlier: () => undefined }
const NO_NAMED: readonly StudioSubagent[] = []
const LANE_REFRESH_MS = 400
const isEmpty = (events: readonly unknown[]): boolean => events.length === 0

function chatMemberState(subagent: StudioSubagent): SubagentFamilyState {
  if (subagent.status === 'needs_input') return 'waiting'
  if (subagent.status === 'failed' || subagent.status === 'stopped') return subagent.status
  return subagentEnded(subagent.status) ? 'done' : 'working'
}

function laneMemberState(lane: TranscriptToolEntry): SubagentFamilyState {
  const state = laneAgentState(lane)
  return state === 'working' || state === 'failed' || state === 'stopped' || state === 'unknown' ? state : 'done'
}

const STATE_WORDS: Readonly<Record<SubagentFamilyState, string>> = {
  working: 'Working',
  waiting: 'Waiting on you',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  unknown: 'Ran in the background',
}

/** A family's members and parent from what is read of the chat in view. Pure, so it is tested without a view. */
export function subagentFamilyOf(input: {
  views: readonly SubagentView[]
  rootName: string
  rootCli: AgentCli | null
  viewedCli: AgentCli | null
  nameOfChat: (agentId: string) => string | undefined
  chats: readonly StudioSubagent[]
  entries: readonly TranscriptEntry[]
  push: (view: SubagentView) => void
  pop: () => void
  hasMore: boolean
  loadEarlier: () => void
}): SubagentFamily {
  const { views, entries, chats, viewedCli, push } = input
  const top = views.at(-1)
  const under = views.at(-2)
  const owner = top ? subagentViewOwner(top) : undefined
  const laneMembers = (lanes: readonly TranscriptToolEntry[], ownerAgentId: string): SubagentFamilyMember[] =>
    lanes.map((lane) => {
      const state = laneMemberState(lane)
      const name = laneName(lane)
      return {
        key: `lane:${lane.id}`,
        kind: 'lane',
        name,
        cli: viewedCli,
        state,
        words: laneOutcomeWords(lane) ?? STATE_WORDS[state],
        open: () => push({ kind: 'lane', ownerAgentId, laneId: lane.id, label: name }),
        source: { kind: 'lane', lane },
      }
    })
  let children: SubagentFamilyMember[]
  if (top?.kind === 'lane') {
    const viewed = collectAgentLanes(entries).find((lane) => lane.id === top.laneId)
    children = viewed ? laneMembers(childAgentLanes(viewed), top.ownerAgentId) : []
  } else {
    const chatId = owner ?? ''
    children = [
      ...chats.map((subagent): SubagentFamilyMember => {
        const state = chatMemberState(subagent)
        return {
          key: `chat:${subagent.id}`,
          kind: 'chat',
          name: subagent.name,
          cli: subagent.cli,
          state,
          words: STATE_WORDS[state],
          open: () => push({ kind: 'chat', agentId: subagent.id, label: subagent.name }),
          source: { kind: 'chat', subagent },
        }
      }),
      ...laneMembers(directAgentLanes(entries), chatId),
    ]
  }
  const parent: SubagentFamilyParent | null = !top
    ? null
    : !under
      ? { name: input.rootName, relation: 'Main chat', cli: input.rootCli, open: input.pop }
      : {
          name: (under.kind === 'chat' ? input.nameOfChat(under.agentId) : undefined) ?? under.label ?? 'Subagent',
          relation: 'Parent agent',
          cli: viewedCli,
          open: input.pop,
        }
  return { parent, children, hasMore: input.hasMore, loadEarlier: input.loadEarlier }
}

/** How a member stands, with its clock while it works. */
export function SubagentFamilyStatus({ member }: { member: SubagentFamilyMember }): JSX.Element {
  return member.source.kind === 'chat' ? (
    <SubagentStatusWords subagent={member.source.subagent} />
  ) : (
    <LaneStatus lane={member.source.lane} />
  )
}

function FamilyReader({
  workspaceId,
  rootAgentId,
  viewedAgentId,
  views,
  root,
  viewed,
  active,
  children,
}: {
  workspaceId: string
  rootAgentId: string
  viewedAgentId: string
  views: readonly SubagentView[]
  root: ChatSource | null
  viewed: ChatSource
  active: boolean
  children: (family: SubagentFamily) => ReactNode
}): JSX.Element {
  const placeRef = useRef<HTMLDivElement | null>(null)
  const placed = useChatViewActive(placeRef)
  const seen = active && placed
  const session = useConversationSession(viewed.root, workspaceId, viewedAgentId, { active: seen })
  const events = useDeferredValue(useThrottledValue(session.events, LANE_REFRESH_MS, seen, isEmpty))
  const { entries } = useMemo(() => projectConversation(events), [events])
  const hereChats = useStudioSubagents(workspaceId, viewedAgentId)
  const named = viewed.remote?.agentId === viewedAgentId ? viewed.remote.subagents : undefined
  const chats = useMemo(
    () => (viewed.remote ? studioSubagentsOf(named ?? NO_NAMED_ROWS) : hereChats),
    [viewed.remote, named, hereChats],
  )
  const rootBinding = root?.binding ?? viewed.binding
  const family = useMemo(
    () =>
      subagentFamilyOf({
        views,
        rootName: rootBinding.agent.name,
        rootCli: cliForConversationProvider(rootBinding.agent.conversation.providerId) as AgentCli | null,
        viewedCli: cliForConversationProvider(viewed.binding.agent.conversation.providerId) as AgentCli | null,
        nameOfChat: (agentId) =>
          chats.find((chat) => chat.id === agentId)?.name ??
          root?.remote?.subagents.find((row) => row.agentId === agentId)?.title,
        chats: views.at(-1)?.kind === 'lane' ? NO_NAMED : chats,
        entries,
        push: (view) => pushSubagentView(workspaceId, rootAgentId, view),
        pop: () => popSubagentView(workspaceId, rootAgentId),
        hasMore: session.hasMore,
        loadEarlier: () => void session.loadEarlier().catch(() => undefined),
      }),
    [views, rootBinding, viewed, root, chats, entries, workspaceId, rootAgentId, session],
  )
  return (
    <div ref={placeRef} className="contents">
      {children(family)}
    </div>
  )
}

const NO_NAMED_ROWS: readonly never[] = []

/**
 * The family of the chat being viewed in a tab, for what is drawn beside it,
 * wherever that chat runs: it reads through the chat's own transport. `active`
 * is whether what it draws can be seen; hidden, it rests as a hidden chat does.
 */
export function SubagentFamilyScope({
  workspaceId,
  rootAgentId,
  active = true,
  children,
}: {
  workspaceId: string
  rootAgentId: string
  active?: boolean
  children: (family: SubagentFamily) => ReactNode
}): JSX.Element {
  const views = useSubagentViews(workspaceId, rootAgentId)
  const top = views.at(-1)
  const viewedAgentId = top ? subagentViewOwner(top) : rootAgentId
  const root = useChatSource(workspaceId, rootAgentId)
  const viewed = useChatSource(workspaceId, viewedAgentId)
  if (!viewed) return <>{children(NO_FAMILY)}</>
  const reader = (
    <FamilyReader
      key={`${workspaceId}:${viewedAgentId}`}
      workspaceId={workspaceId}
      rootAgentId={rootAgentId}
      viewedAgentId={viewedAgentId}
      views={views}
      root={root}
      viewed={viewed}
      active={active}
    >
      {children}
    </FamilyReader>
  )
  return viewed.transport ? (
    <ConversationTransportProvider value={viewed.transport}>{reader}</ConversationTransportProvider>
  ) : (
    reader
  )
}
