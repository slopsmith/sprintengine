import React from 'react'

import { Section, TruncatedText } from '../../../ui'
import { subagentLaneLabel } from '../../../panels/agentChat/conversationTimeline'
import { useChatSubagents, type ChatSubagent } from '../../../panels/agentChat/chatSubagentsStore'
import type { AgentCli } from '../../../../types/workspace'
import { SubagentIcon } from '../../../panels/agentChat/subagentIcon'
import { LaneGlyph, LaneStatus } from '../../../panels/agentChat/subagentStatus'
import { SubagentStatusWords } from '../agents/studioSubagents'
import { openAgentsPane } from '../agents/agentsPaneFocus'
import { PanelCard, PanelRow } from './PanelRow'

// The panel's Subagents section: the chat's own children, and nothing at all
// when it has none. It reads `chatSubagentsStore`, which the chat fills from
// its transcript and its records, so it knows nothing of how they are found;
// `open` below is the one line that says where a row goes.

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="m6 3.5 4.5 4.5L6 12.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SubagentRow({ subagent, cli, onOpen }: { subagent: ChatSubagent; cli: AgentCli | null; onOpen: () => void }) {
  const name = subagent.kind === 'lane' ? subagentLaneLabel(subagent.lane) : subagent.subagent.name
  return (
    <PanelRow
      glyph={
        subagent.kind === 'lane' ? (
          // The panel stands outside the chat, so a lane cannot read the harness
          // from the conversation around it: it runs on its parent's.
          cli ? (
            <SubagentIcon cli={cli} />
          ) : (
            <LaneGlyph tool={subagent.lane} />
          )
        ) : (
          <SubagentIcon cli={subagent.subagent.cli} />
        )
      }
      label={<TruncatedText as="span" text={name} />}
      detail={
        subagent.kind === 'lane' ? (
          <LaneStatus lane={subagent.lane} />
        ) : (
          <SubagentStatusWords subagent={subagent.subagent} />
        )
      }
      meta={<ChevronGlyph className="icon-xs" />}
      onClick={onOpen}
      ariaLabel={name}
    />
  )
}

export function ChatPanelSubagents({
  workspaceId,
  agentId,
  cli,
}: {
  workspaceId: string
  agentId: string | null
  /** The harness of the chat being viewed. */
  cli: AgentCli | null
}) {
  const subagents = useChatSubagents(workspaceId, agentId)
  if (!agentId || subagents.length === 0) return null
  return (
    <Section title="Subagents" inset="flush">
      <PanelCard>
        {subagents.map((subagent) => (
          <SubagentRow
            key={subagent.id}
            subagent={subagent}
            cli={cli}
            onOpen={() => openAgentsPane(workspaceId, agentId, subagent.id)}
          />
        ))}
      </PanelCard>
    </Section>
  )
}
