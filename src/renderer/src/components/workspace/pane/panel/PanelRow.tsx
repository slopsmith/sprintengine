import React from 'react'

import { RowButton, Tooltip } from '../../../ui'

// One row of the panel: a glyph, a name and what there is to say about it. A
// row that opens something is a `RowButton`; a row that can only say something
// is plain text, with no hover and no pointer, so nothing on the panel offers a
// click that goes nowhere.

const ROW_LAYOUT = 'flex min-h-control-md w-full min-w-0 items-center gap-2.5'

export type PanelRowProps = {
  glyph: React.ReactNode
  label: React.ReactNode
  /** The line under the name. */
  detail?: React.ReactNode
  /** The fact at the row's end. */
  meta?: React.ReactNode
  /** Null: the row says something and does nothing. */
  onClick?: (() => void) | null
  ariaLabel?: string
  /** Anything else the row's button takes: a popover's trigger props, a context menu. */
  buttonProps?: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'> &
    Record<`data-${string}`, unknown>
  buttonRef?: React.Ref<HTMLButtonElement>
  /** What the row says on hover and focus, beyond its words. */
  tooltip?: React.ReactNode
  /** Names the row for what reads it. */
  dataBranch?: string
}

export function PanelRow({
  glyph,
  label,
  detail,
  meta,
  onClick,
  ariaLabel,
  buttonProps,
  buttonRef,
  tooltip,
  dataBranch,
}: PanelRowProps) {
  const body = (
    <>
      <span className="flex shrink-0 items-center text-[color:var(--text-muted)]">{glyph}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-body text-[color:var(--text-strong)]">{label}</span>
        {detail ? <span className="block truncate text-meta text-[color:var(--text-muted)]">{detail}</span> : null}
      </span>
      {meta !== undefined && meta !== null ? (
        <span className="flex min-w-0 max-w-[60%] shrink-0 items-center gap-1.5 text-meta text-[color:var(--text-subtle)]">
          {meta}
        </span>
      ) : null}
    </>
  )
  if (!onClick)
    return (
      <div
        className={`${ROW_LAYOUT} px-2 py-1.5`}
        data-panel-row="fact"
        data-panel-branch={dataBranch}
        aria-label={ariaLabel}
      >
        {body}
      </div>
    )
  const row = (
    <RowButton
      ref={buttonRef}
      density="bleed"
      onClick={onClick}
      aria-label={ariaLabel}
      data-panel-row="action"
      data-panel-branch={dataBranch}
      className={ROW_LAYOUT}
      {...buttonProps}
    >
      {body}
    </RowButton>
  )
  return tooltip ? (
    <Tooltip content={tooltip} placement="left" wrapperClassName="flex w-full">
      {row}
    </Tooltip>
  ) : (
    row
  )
}

/** A section's rows, on the panel's raised card. */
export function PanelCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface-raised)]">
      {children}
    </div>
  )
}
