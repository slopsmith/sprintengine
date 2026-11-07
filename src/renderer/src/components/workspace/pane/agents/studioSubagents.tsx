import React, { useDeferredValue, useMemo, useRef, type JSX } from 'react'
import { subagentEnded } from '../../../../../../shared/conversation/subagentStatus'
import { useConversationSessions } from '../../../../hooks/conversationSessionsStore'
import { Badge, GhostButton, InlineNotice, RowButton, Spinner, TruncatedText } from '../../../ui'
import { ConversationLinkProvider, ConversationMarkdown } from '../../../panels/agentChat/conversationLinks'
import {
  projectConversation,
  type TranscriptEntry,
  type TranscriptToolEntry,
} from '../../../panels/agentChat/conversationProjection'
import { useConversationTransport } from '../../../panels/agentChat/conversationTransport'
import {
  latestSessionOf,
  SubagentStatusWords,
  useAnswerSubagentRequest,
  type StudioSubagent,
} from '../../../panels/agentChat/chatSubagents'
import { ConversationPendingDock } from '../../../panels/agentChat/pendingDock'
import { SubagentIcon } from '../../../panels/agentChat/subagentIcon'
import { AGENT_LINE_CLASS, AGENT_NAME_CLASS, AGENT_STATUS_CLASS } from '../../../panels/agentChat/subagentStatus'
import { WorkTimeline } from '../../../panels/agentChat/timelineRows'
import { useConversationSession } from '../../../panels/agentChat/useConversationSession'

// The Studio sub-agents of a chat, beside the agents its CLI spawned on its
// own. A sub-agent is a chat of its own that belongs to this one
// (subagent-tools.ts), so its row reads from its record and its session, and
// its thread is its own transcript rather than a lane of the parent's. A chat on
// a paired machine has no record here: that machine reads them for it and names
// them (`conversation-subagents`), and each is followed as a chat over there.

const ReadOnlyBadge = (): JSX.Element => (
  <Badge tone="neutral" ariaLabel="Read-only: it cannot change anything" className="shrink-0 whitespace-nowrap">
    Read-only
  </Badge>
)

export function StudioSubagentRow({
  subagent,
  onOpen,
}: {
  subagent: StudioSubagent
  onOpen: (id: string) => void
}): JSX.Element {
  return (
    <RowButton
      density="row"
      onClick={() => onOpen(subagent.id)}
      aria-label={`${subagent.name}: ${subagent.task || 'sub-agent'}`}
    >
      <span className="@container flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`${AGENT_LINE_CLASS} text-meta`}>
          <SubagentIcon cli={subagent.cli} />
          <span className={`${AGENT_NAME_CLASS} font-medium text-[color:var(--text-default)]`}>{subagent.name}</span>
          {subagent.readOnly ? <ReadOnlyBadge /> : null}
          <span className={`${AGENT_STATUS_CLASS} text-micro text-[color:var(--text-subtle)]`}>
            <SubagentStatusWords subagent={subagent} />
          </span>
        </span>
        {subagent.task || subagent.error ? (
          <TruncatedText
            as="span"
            text={subagent.error ?? subagent.task}
            className={`min-w-0 pl-6 text-micro ${subagent.error ? 'text-[color:var(--tone-error)]' : 'text-[color:var(--text-muted)]'}`}
          />
        ) : null}
      </span>
    </RowButton>
  )
}

/**
 * One sub-agent's own transcript, as an agent's thread reads: what it was asked,
 * the steps it took, what it said on the way, and its final reply as the
 * report. What it waits on the person for shows here to be answered, since it
 * has no chat view of its own. One on a paired machine is read through its own
 * transport, which the tab provides around this.
 */
export const StudioSubagentThread = React.memo(function StudioSubagentThread({
  subagent,
  workspaceId,
  root,
  active,
  onBack,
}: {
  subagent: StudioSubagent
  workspaceId: string
  root: string
  active: boolean
  onBack: () => void
}) {
  const session = useConversationSession(root, workspaceId, subagent.id, { active })
  const events = useDeferredValue(session.events)
  const { entries } = useMemo(() => projectConversation(events), [events])
  const working = !subagentEnded(subagent.status)
  const steps = useMemo(() => entries.filter((entry): entry is TranscriptToolEntry => entry.kind === 'tool'), [entries])
  const replies = entries.filter((entry) => entry.kind === 'assistant')
  const report = replies.at(-1)?.text.trim() ?? ''
  const said = useMemo(() => replies.flatMap((entry) => entry.intermediateText ?? []), [replies])
  const asked = entries.find((entry) => entry.kind === 'user')?.text.trim() ?? subagent.task
  const pending = entries.filter(
    (entry): entry is Extract<TranscriptEntry, { kind: 'approval' }> =>
      entry.kind === 'approval' && entry.status === 'pending',
  )
  const localSession = latestSessionOf(useConversationSessions(), workspaceId, subagent.id)
  const sessionId = subagent.sessionId ?? localSession?.sessionId
  const transport = useConversationTransport()
  // The root a session is keyed by on a paired machine is its link, which is no
  // folder here to resolve a file link against.
  const fileRoot = transport.kind === 'remote' ? '' : root
  const { operate } = transport.capabilities
  const { responding, refusal, respond } = useAnswerSubagentRequest(sessionId)
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <ConversationLinkProvider
      workspaceId={workspaceId}
      agentId={subagent.id}
      cwd={fileRoot}
      workspaceRoot={fileRoot}
      {...(subagent.providerId ? { providerId: subagent.providerId } : {})}
    >
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-2">
        <GhostButton size="inline" tone="subtle" align="start" onClick={onBack}>
          ‹ All agents
        </GhostButton>
        <div className="@container mt-2 px-2">
          <div className={`${AGENT_LINE_CLASS} text-body`}>
            <SubagentIcon cli={subagent.cli} />
            <span className={`${AGENT_NAME_CLASS} font-medium text-[color:var(--text-strong)]`}>{subagent.name}</span>
            {subagent.readOnly ? <ReadOnlyBadge /> : null}
            <span className={`${AGENT_STATUS_CLASS} text-meta text-[color:var(--text-subtle)]`}>
              <SubagentStatusWords subagent={subagent} />
            </span>
          </div>
        </div>
        {asked ? (
          <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap px-2 text-meta text-[color:var(--text-default)]">
            {asked}
          </p>
        ) : null}
        {subagent.error ? (
          <InlineNotice tone="error" title="Why it ended" detail={subagent.error} className="mx-2 mt-2" />
        ) : null}
        {!session.hydrated && !session.error ? (
          <div className="flex items-center gap-2 px-2 py-3 text-meta text-[color:var(--text-muted)]">
            <Spinner />
            <span role="status">Reading its chat…</span>
          </div>
        ) : null}
        {session.error ? (
          <InlineNotice tone="error" title="Couldn't read this sub-agent." detail={session.error} className="mt-2" />
        ) : null}
        <h3 className="mt-4 px-2 pb-1 text-micro font-medium text-[color:var(--text-subtle)]">Steps</h3>
        {steps.length > 0 ? (
          <div className="px-1">
            <WorkTimeline tools={steps} live={working} intermediateText={said} />
          </div>
        ) : (
          <p className="px-2 text-meta text-[color:var(--text-subtle)]">
            {working ? 'No steps yet: it is still getting started.' : 'It took no steps of its own.'}
          </p>
        )}
        {pending.length > 0 ? (
          <div className="mt-3">
            <ConversationPendingDock
              pendingApprovals={pending}
              workspaceRoot={fileRoot || undefined}
              onApprove={respond}
              // Read-only: what it asks is shown, not answerable.
              busy={responding || !operate}
            />
          </div>
        ) : null}
        {refusal ? (
          <InlineNotice tone="error" title="The answer did not go." detail={refusal} className="mt-2" />
        ) : null}
        {report ? (
          <>
            <h3 className="mt-4 px-2 pb-1 text-micro font-medium text-[color:var(--text-subtle)]">
              {working ? 'So far' : 'Report'}
            </h3>
            <div className="min-w-0 px-2 text-body">
              <ConversationMarkdown text={report} />
            </div>
          </>
        ) : null}
      </div>
    </ConversationLinkProvider>
  )
})
