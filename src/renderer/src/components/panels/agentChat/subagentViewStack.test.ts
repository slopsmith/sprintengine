import { afterEach, expect, test } from 'vitest'
import {
  popSubagentView,
  popSubagentViewsTo,
  pushSubagentView,
  readSubagentViews,
  resetSubagentViews,
  subagentViewOwner,
  viewedChatOf,
  type SubagentView,
} from './subagentViewStack'

afterEach(() => resetSubagentViews())

const chat: SubagentView = { kind: 'chat', agentId: 'sub-1' }
const lane: SubagentView = { kind: 'lane', ownerAgentId: 'sub-1', laneId: 'toolu_1' }

test('going in stacks up, and Back pops one level at a time', () => {
  pushSubagentView('w', 'root', chat)
  pushSubagentView('w', 'root', lane)
  expect(readSubagentViews('w', 'root')).toEqual([chat, lane])
  popSubagentView('w', 'root')
  expect(readSubagentViews('w', 'root')).toEqual([chat])
  popSubagentView('w', 'root')
  expect(readSubagentViews('w', 'root')).toEqual([])
})

test('a stack belongs to its workspace and its chat', () => {
  pushSubagentView('w', 'root', chat)
  expect(readSubagentViews('w', 'other')).toEqual([])
  expect(readSubagentViews('other', 'root')).toEqual([])
})

test('opening what is already on the stack goes back to it rather than stacking it twice', () => {
  pushSubagentView('w', 'root', chat)
  pushSubagentView('w', 'root', lane)
  pushSubagentView('w', 'root', chat)
  expect(readSubagentViews('w', 'root')).toEqual([chat])
})

test('a crumb goes back to its depth, and depth nought is the chat itself', () => {
  pushSubagentView('w', 'root', chat)
  pushSubagentView('w', 'root', lane)
  popSubagentViewsTo('w', 'root', 1)
  expect(readSubagentViews('w', 'root')).toEqual([chat])
  popSubagentViewsTo('w', 'root', 0)
  expect(readSubagentViews('w', 'root')).toEqual([])
})

test('the chat in view is the top of the stack, and a lane’s is the chat holding it', () => {
  expect(viewedChatOf('w', 'root')).toBe('root')
  pushSubagentView('w', 'root', chat)
  expect(viewedChatOf('w', 'root')).toBe('sub-1')
  pushSubagentView('w', 'root', { kind: 'lane', ownerAgentId: 'root', laneId: 'toolu_2' })
  expect(viewedChatOf('w', 'root')).toBe('root')
  expect(subagentViewOwner(lane)).toBe('sub-1')
})
