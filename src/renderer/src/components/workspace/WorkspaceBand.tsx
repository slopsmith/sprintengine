// The window's band over the content column: the slim 36px row that took the
// place of the header bar (owner ruling 2026-11-07). The chat's tabs are the band
// over a workspace; what is left of its own is what has no other home. Left→right:
//
//   window launcher (sidebar hidden) · a door's lifted bar ····· module items ·
//   bell and account (rail hidden) · panel toggle · caption reserve
//
// It is an `app-drag` region and interactive controls opt out. Non-mac window
// controls are NOT here — they pin to the window's absolute top-right corner
// (WorkspaceManager), since the pane column can own that corner.
//
// Its ground is --bg-chrome-bar, the token the whole 36px band shares (rail
// reserve, sidebar chrome, this row, the pane's strip). On a solid window that
// token is --bg-canvas, the ground the rail and the sidebar chrome row inherit,
// so the band reads as one colour across. Under glass it goes transparent, and
// this strip stops being the one opaque tile in a band that is otherwise OS
// frost.

import React from 'react'
import { IconButton, Tooltip } from '../ui'
import { BandPanelToggle } from './BandPanelToggle'
import { APP_RAIL_WIDTH, TRAFFIC_LIGHT_RESERVE } from './AppRail'
import { AppMenuButton } from './SidebarChrome'
import { WindowCaptionReserve } from './WindowControls'
import type { WorkspaceId } from '../../types/workspace'

type WorkspaceBandProps<MenuItem extends string> = {
  // Window-scoped active workspace, which the panel toggle acts on (null while
  // no workspace is active).
  activeWorkspaceId: WorkspaceId | null
  // Collapsed-sidebar launcher: when the sidebar is hidden, the window's left
  // controls (traffic-light inset / app-menu on win-linux, open-sidebar, search,
  // and a New Agent "+") relocate here so they stay at the window's top-left
  // corner.
  isMac: boolean
  isFullScreen: boolean
  sidebarCollapsed: boolean
  // Whether the app rail stands to this strip's left. It does on a desktop
  // window; the narrow layout hides it with the sidebar, and the strip then
  // starts at the window's edge, under the traffic lights.
  besideRail?: boolean
  // Width (px) the strip leaves empty at its right end for the win/linux caption
  // buttons, which float over the window's top-right corner. Non-zero only when
  // THIS strip owns that corner — the host passes 0 on macOS and whenever the
  // workspace pane column is open and docked beside it and takes the corner
  // instead. A maximised pane fills the row BELOW this strip, so the corner
  // stays here (paneStripOwnsCaptionCorner).
  captionReserve: number
  onToggleSidebar: () => void
  onOpenSearch: () => void
  onNewChat: () => void
  menuItems: readonly MenuItem[]
  onShowMenu: (event: React.MouseEvent<HTMLButtonElement>, label: MenuItem) => void
  // What modules put in the band (BandActions), filled by WorkspaceManager.
  actionsSlot: React.ReactNode
  // The bell and the account, while the rail that holds them is hidden.
  accountSlot?: React.ReactNode
  // True when a global "door" surface or New chat covers the workspace card.
  // Whatever is about the workspace steps aside, since there is no live
  // workspace to act on, and a door's own bar takes the band (`surfaceBarSlotRef`).
  globalSurfaceActive: boolean
  // Destination for the active door surface's lifted bar (title · status · context
  // · actions). Filled only while `globalSurfaceActive`.
  surfaceBarSlotRef: React.Ref<HTMLDivElement>
}

// Open-sidebar toggle for the collapsed launcher (panel-left glyph).
function OpenSidebarButton({ onToggle }: { onToggle: () => void }) {
  return (
    <Tooltip content="Open sidebar" placement="bottom">
      <IconButton onClick={onToggle} aria-label="Open sidebar" aria-pressed={false} className="app-no-drag">
        <svg viewBox="0 0 16 16" fill="none" className="icon-sm" aria-hidden="true">
          <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 3V13" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </IconButton>
    </Tooltip>
  )
}

function LauncherSearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Tooltip content="Search" placement="bottom">
      <IconButton onClick={onOpen} aria-label="Search" className="app-no-drag">
        <svg viewBox="0 0 16 16" fill="none" className="icon-sm" aria-hidden="true">
          <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </IconButton>
    </Tooltip>
  )
}

// "New" + — the collapsed launcher's creation entry, opening New chat exactly as
// the sidebar cluster does.
function NewChatButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip content="New chat" placement="bottom">
      <IconButton onClick={onClick} aria-label="New chat" className="app-no-drag">
        <svg viewBox="0 0 16 16" fill="none" className="icon-sm" aria-hidden="true">
          <path d="M8 3.5V12.5M3.5 8H12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </IconButton>
    </Tooltip>
  )
}

/**
 * The room the band's left end leaves for the macOS traffic lights: what
 * they run past the rail's edge while the rail stands beside the strip, and
 * all of their reserve when the narrow layout has hidden the rail (a window
 * at its narrowest, zoomed in) and the strip starts at the window's edge.
 */
export function bandTrafficLightInset({
  isMac,
  isFullScreen,
  sidebarCollapsed,
  besideRail,
}: {
  isMac: boolean
  isFullScreen: boolean
  sidebarCollapsed: boolean
  besideRail: boolean
}): number {
  if (!isMac || isFullScreen || !sidebarCollapsed) return 0
  return besideRail ? TRAFFIC_LIGHT_RESERVE - APP_RAIL_WIDTH : TRAFFIC_LIGHT_RESERVE
}

export function WorkspaceBand<MenuItem extends string>({
  activeWorkspaceId,
  isMac,
  isFullScreen,
  sidebarCollapsed,
  besideRail = true,
  captionReserve,
  onToggleSidebar,
  onOpenSearch,
  onNewChat,
  menuItems,
  onShowMenu,
  actionsSlot,
  accountSlot = null,
  globalSurfaceActive,
  surfaceBarSlotRef,
}: WorkspaceBandProps<MenuItem>) {
  // With the sidebar hidden, the app-menu (win-linux) and the open-sidebar /
  // search / New Agent launcher relocate here. The app rail stays put when the
  // sidebar collapses (app shell, 2026-09-05), so this strip starts at the rail's
  // edge — but the macOS traffic lights run PAST that edge: the hiddenInset frame
  // pins them at x:12 and they end at TRAFFIC_LIGHT_RESERVE (78), 22px beyond the
  // 56px rail. The sidebar's own chrome row insets by that remainder when it is
  // the strip beside the rail (SidebarChrome); when it is hidden this strip is,
  // and takes the same inset — without it the launcher's first glyph sat under
  // the green light. In fullscreen the lights are hidden and the inset collapses.
  const trafficLightInset = bandTrafficLightInset({ isMac, isFullScreen, sidebarCollapsed, besideRail })
  return (
    <div className="chrome-bar app-drag flex h-[36px] shrink-0 items-center bg-[color:var(--bg-chrome-bar)]">
      <div className="flex min-w-0 flex-1 items-center">
        {trafficLightInset > 0 ? (
          <div aria-hidden="true" className="shrink-0" style={{ width: trafficLightInset }} />
        ) : null}
        {sidebarCollapsed ? (
          <div className="flex shrink-0 items-center gap-0.5 pl-1.5">
            {!isMac && menuItems.length > 0 ? <AppMenuButton menuItems={menuItems} onShowMenu={onShowMenu} /> : null}
            <OpenSidebarButton onToggle={onToggleSidebar} />
            <LauncherSearchButton onOpen={onOpenSearch} />
            <NewChatButton onClick={onNewChat} />
          </div>
        ) : null}
        {/* The door's lifted bar. `pl-5` is the door gutter, not a nudge: the
            door's name sits on the same 20px left edge as the content under it
            (the tab row, the canvas body), so the title and the page it names
            share one vertical line. */}
        {globalSurfaceActive ? (
          <div ref={surfaceBarSlotRef} className="app-no-drag flex min-w-0 flex-1 items-center gap-2.5 pl-5 pr-2" />
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 pr-1.5">
        {actionsSlot}
        {accountSlot ? <div className="app-no-drag flex items-center gap-1 pl-1">{accountSlot}</div> : null}
        {/* Workspace-scoped, so it goes with the rest while a door paints over the
            card: toggling a pane beside a page nobody asked it for would be a
            control that visibly does nothing. */}
        {globalSurfaceActive ? null : <BandPanelToggle activeWorkspaceId={activeWorkspaceId} />}
      </div>
      {/* Win/linux: the caption buttons float over this corner, so the band's
          controls stop short of them rather than sitting under Close. */}
      <WindowCaptionReserve width={captionReserve} />
    </div>
  )
}
