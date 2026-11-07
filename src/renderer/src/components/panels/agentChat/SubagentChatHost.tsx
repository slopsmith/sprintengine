import { type JSX, type ReactNode, useCallback, useMemo, useRef } from 'react'
import { GhostButton, InlineNotice, LinkButton, OutlineButton, TruncatedText } from '../../ui'
import { useChatViewActive } from './chatViewActivity'
import { LaneChatView } from './LaneChatView'
import { SubagentFamilyScope, type SubagentFamily } from './subagentFamily'
import { usePublishSubagentFamily, useSubagentFamilyShown } from './subagentFamilyStore'
import { harnessName } from './subagentIcon'
import {
  popSubagentView,
  popSubagentViewsTo,
  SubagentStackProvider,
  subagentViewOwner,
  useSubagentViews,
  type SubagentView,
} from './subagentViewStack'

// A chat's tab, with the subagents the person went into drawn in its place. The
// chat itself and any sub-agent chat under the top of the stack stay mounted and
// hidden, as a tab that is not selected is: what such a view holds (a message
// queued behind its turn) lives in that view, and its turn may end while it is
// hidden. A lane is only a reading of its owner's transcript, so it has nothing
// to keep and only the top one is mounted. The panel beside the tab reads who
// the agent in view is related to from here.

export type SubagentChatCrumb = { key: string; name: string; depth: number }

/** What the host hands the view it draws for one sub-agent on the stack. */
export type SubagentChatLayer = {
  agentId: string
  parentAgentId: string
  parentName: string
  crumbs: readonly SubagentChatCrumb[]
  active: boolean
  onCrumb: (depth: number) => void
  onBack: () => void
}

/** What a subagent runs on, in words: its harness and its model. */
export function subagentFacts(cli: string | null, modelId: string): string {
  const model = modelId.replace(/\[.*$/u, '')
  return [cli ? harnessName(cli) : null, model && model !== 'default' ? model : null].filter(Boolean).join(' · ')
}

/** The path back up from the view at `depth`: the chat first, then each view it was reached through. */
export function subagentCrumbs(
  rootName: string,
  views: readonly SubagentView[],
  depth: number,
  nameOf: (view: SubagentView) => string | undefined,
): SubagentChatCrumb[] {
  return [
    { key: 'root', name: rootName, depth: 0 },
    ...views
      .slice(0, depth)
      .map((view, index) => ({ key: `${index}`, name: nameOf(view) ?? view.label ?? 'Subagent', depth: index + 1 })),
  ]
}

/** The band over a subagent's chat: the way back up, its name, and how it is doing. */
export function SubagentViewHeader({
  crumbs,
  name,
  facts,
  status,
  action,
  onCrumb,
}: {
  crumbs: readonly SubagentChatCrumb[]
  name: string
  /** What it runs on, in words. */
  facts?: string
  status?: ReactNode
  /** The control beside its status: a lane's Stop. */
  action?: ReactNode
  onCrumb: (depth: number) => void
}): JSX.Element {
  return (
    <div
      data-subagent-header=""
      className="flex h-control-lg shrink-0 items-center gap-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--agent-surface)] px-3 text-meta text-[color:var(--text-muted)]"
    >
      <nav aria-label="Back up to the chat" className="flex min-w-0 flex-1 items-center gap-2">
        {crumbs.map((crumb, index) => (
          <span key={crumb.key} className="flex min-w-0 shrink items-center gap-2">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            <LinkButton ink="quiet" onClick={() => onCrumb(crumb.depth)} className="min-w-0 max-w-full">
              <TruncatedText as="span" text={`${index === 0 ? '‹ ' : ''}${crumb.name}`} className="min-w-0" />
            </LinkButton>
          </span>
        ))}
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="flex min-w-0 shrink-[2] font-medium text-[color:var(--text-strong)]">
          <TruncatedText as="span" text={name} className="min-w-0" />
        </span>
      </nav>
      {facts || status ? (
        <span className="ml-auto flex shrink-0 items-center gap-1 text-micro tabular-nums">
          {facts ? <span className="@max-[420px]:hidden">{facts}</span> : null}
          {facts && status ? <span aria-hidden="true">·</span> : null}
          {status}
        </span>
      ) : null}
      {action}
    </div>
  )
}

/** Why a sub-agent ended, where it failed: said under its header, as its transcript may not. */
export function SubagentEndNotice({ error }: { error: string | null }): JSX.Element | null {
  if (!error) return null
  return <InlineNotice tone="error" title="Why it ended" detail={error} className="mx-3 mt-2 shrink-0" />
}

/**
 * Where a subagent cannot take a message there is no box at all, only this, in
 * the box's place (owner ruling 2026-11-07): that it has to go through the
 * parent, why, and the way there.
 */
export function SubagentBlockedBar({
  why,
  parentName,
  onGoToParent,
}: {
  why: string
  parentName: string
  onGoToParent: () => void
}): JSX.Element {
  return (
    <div
      data-subagent-blocked=""
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-lg)] border border-dashed border-[color:var(--border-default)] bg-[color:var(--bg-surface)] px-5 py-3"
    >
      <p className="min-w-0 flex-1 basis-60 text-meta text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text-default)]">
          To reach this subagent, speak to {parentName}.
        </span>{' '}
        {why}
      </p>
      <OutlineButton size="xs" onClick={onGoToParent} className="max-w-full shrink-0">
        <TruncatedText as="span" text={`Go to ${parentName}`} className="min-w-0" />
      </OutlineButton>
    </div>
  )
}

function FamilyPublisher({
  workspaceId,
  rootAgentId,
  family,
}: {
  workspaceId: string
  rootAgentId: string
  family: SubagentFamily
}): null {
  usePublishSubagentFamily(workspaceId, rootAgentId, family)
  return null
}

export function SubagentChatHost({
  workspaceId,
  rootAgentId,
  rootName,
  renderChat,
  chatName,
  children,
}: {
  workspaceId: string
  rootAgentId: string
  rootName: string
  /** One sub-agent's chat, under its header. `onBack` goes to the view under it. */
  renderChat: (chat: SubagentChatLayer) => ReactNode
  /** What a sub-agent on the stack is called, where it can be read. */
  chatName?: (agentId: string) => string | undefined
  /** The chat itself. */
  children: ReactNode
}): JSX.Element {
  const views = useSubagentViews(workspaceId, rootAgentId)
  const scope = useMemo(() => ({ workspaceId, rootAgentId }), [workspaceId, rootAgentId])
  const nameOf = (view: SubagentView) => (view.kind === 'chat' ? chatName?.(view.agentId) : undefined)
  const onCrumb = useCallback(
    (depth: number) => popSubagentViewsTo(workspaceId, rootAgentId, depth),
    [workspaceId, rootAgentId],
  )
  const onBack = useCallback(() => popSubagentView(workspaceId, rootAgentId), [workspaceId, rootAgentId])
  const placeRef = useRef<HTMLDivElement | null>(null)
  const seen = useChatViewActive(placeRef)
  const active = useSubagentFamilyShown(workspaceId, rootAgentId) && seen
  return (
    <SubagentStackProvider value={scope}>
      <SubagentFamilyScope workspaceId={workspaceId} rootAgentId={rootAgentId} active={active}>
        {(family) => <FamilyPublisher workspaceId={workspaceId} rootAgentId={rootAgentId} family={family} />}
      </SubagentFamilyScope>
      <div ref={placeRef} className="h-full min-h-0">
        <div className={views.length > 0 ? 'hidden' : 'h-full min-h-0'}>{children}</div>
        {views.map((view, depth) => {
          const top = depth === views.length - 1
          const under = views[depth - 1]
          const crumbs = subagentCrumbs(rootName, views, depth, nameOf)
          const parentName = crumbs.at(-1)!.name
          const parentAgentId = under ? subagentViewOwner(under) : rootAgentId
          if (view.kind === 'lane') {
            if (!top) return null
            return (
              <div key={`lane:${view.ownerAgentId}:${view.laneId}`} className="flex h-full min-h-0 flex-col">
                <LaneChatView
                  workspaceId={workspaceId}
                  view={view}
                  parentName={parentName}
                  crumbs={crumbs}
                  onCrumb={onCrumb}
                  onBack={onBack}
                />
              </div>
            )
          }
          return (
            <div key={`chat:${view.agentId}`} className={top ? 'flex h-full min-h-0 flex-col' : 'hidden'}>
              {renderChat({ agentId: view.agentId, parentAgentId, parentName, crumbs, active: top, onCrumb, onBack })}
            </div>
          )
        })}
      </div>
    </SubagentStackProvider>
  )
}

/** Shown where a view's subagent is gone: a sub-agent deleted while it was open, or a lane that is not there. */
export function SubagentGone({ words, onBack }: { words: string; onBack: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-meta text-[color:var(--text-muted)]">
      <p>{words}</p>
      <GhostButton size="inline" tone="subtle" onClick={onBack}>
        Go back
      </GhostButton>
    </div>
  )
}
