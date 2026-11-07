import { expect, test } from 'vitest'
import { APP_RAIL_WIDTH, TRAFFIC_LIGHT_RESERVE } from './AppRail'
import { bandTrafficLightInset } from './WorkspaceBand'

const mac = { isMac: true, isFullScreen: false, sidebarCollapsed: true }

test('beside the rail, the band leaves room for what the traffic lights run past it', () => {
  expect(bandTrafficLightInset({ ...mac, besideRail: true })).toBe(TRAFFIC_LIGHT_RESERVE - APP_RAIL_WIDTH)
})

test('with the rail hidden by the narrow layout, the band leaves room for all of the traffic lights', () => {
  expect(bandTrafficLightInset({ ...mac, besideRail: false })).toBe(TRAFFIC_LIGHT_RESERVE)
})

test('no room is left with the sidebar open, in fullscreen, or off macOS', () => {
  for (const besideRail of [true, false]) {
    expect(bandTrafficLightInset({ ...mac, sidebarCollapsed: false, besideRail })).toBe(0)
    expect(bandTrafficLightInset({ ...mac, isFullScreen: true, besideRail })).toBe(0)
    expect(bandTrafficLightInset({ ...mac, isMac: false, besideRail })).toBe(0)
  }
})

test('a strip on the top row stands in the band, and at its ends keeps clear of what stands there', async () => {
  const { bandStripMarks } = await import('./WorkspaceLayout')
  const layout = { x: 0, y: 0, width: 1000, height: 800 }
  expect(bandStripMarks({ x: 0, y: 0, width: 1000, height: 800 }, layout)).toEqual({
    'data-band-strip': '',
    'data-band-start': '',
    'data-band-end': '',
  })
  expect(bandStripMarks({ x: 0, y: 0, width: 500, height: 800 }, layout)).toEqual({
    'data-band-strip': '',
    'data-band-start': '',
  })
  expect(bandStripMarks({ x: 500, y: 0, width: 500, height: 800 }, layout)).toEqual({
    'data-band-strip': '',
    'data-band-end': '',
  })
  expect(bandStripMarks({ x: 0, y: 400, width: 1000, height: 400 }, layout), 'under a split it stays put').toBe(null)
})
