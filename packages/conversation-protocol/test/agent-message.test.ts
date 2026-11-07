import assert from 'node:assert/strict'
import { test } from 'vitest'

import { parseConversationClientMessage } from '../src/clientFrames'
import { CONVERSATION_COMMAND_KINDS } from '../src/commands'
import { readConversationMessageOrigin, readConversationSubagentMessage } from '../src/events'
import { CONVERSATION_AGENT_MESSAGE_CAPABILITY, CONVERSATION_CAPABILITIES } from '../src/handshake'
import { parseConversationServerFrame } from '../src/serverFrames'

const frame = (command: Record<string, unknown>) => ({
  type: 'command',
  commandId: 'c1',
  command: { kind: 'messageSubagent', ...command },
})

test('the capability is named and listed, and the kind is known', () => {
  assert.equal(CONVERSATION_AGENT_MESSAGE_CAPABILITY, 'conversation-agent-message')
  assert.ok((CONVERSATION_CAPABILITIES as readonly string[]).includes(CONVERSATION_AGENT_MESSAGE_CAPABILITY))
  assert.ok(CONVERSATION_COMMAND_KINDS.includes('messageSubagent'))
})

test('a client’s command names the agent and carries the words', () => {
  const parsed = parseConversationClientMessage(frame({ toolUseId: 'toolu_agent', message: 'Check the e2e too' }))
  assert.deepEqual(parsed, {
    type: 'command',
    commandId: 'c1',
    command: { kind: 'messageSubagent', toolUseId: 'toolu_agent', message: 'Check the e2e too' },
  })
})

test('a command with no agent or no words is a bad frame', () => {
  assert.equal(parseConversationClientMessage(frame({ message: 'Hi' })), null)
  assert.equal(parseConversationClientMessage(frame({ toolUseId: 'toolu_agent', message: '  ' })), null)
  assert.equal(parseConversationClientMessage(frame({ toolUseId: 'toolu_agent', message: 7 })), null)
})

test('a listed chat’s flag survives when it is a boolean, and absent reads as unknown', () => {
  const listed = (flags: Record<string, unknown>) =>
    parseConversationServerFrame({
      type: 'sessions',
      requestId: 'list-1',
      sessions: [
        {
          workspaceId: 'ws',
          agentId: 'agent',
          title: 'Restyle the design system',
          phase: 'running',
          updatedAt: 2,
          createdAt: 1,
          providerId: 'claude-agent',
          modelId: 'default',
          turnCount: 1,
          lastSeq: 4,
          capabilities: {
            images: true,
            approvals: true,
            questions: true,
            planMode: false,
            interrupt: true,
            checkpoints: false,
            ...flags,
          },
        },
      ],
    }) as { sessions: { capabilities?: { messageSubagent?: boolean } }[] } | null
  assert.equal(listed({ messageSubagent: true })?.sessions[0]?.capabilities?.messageSubagent, true)
  assert.equal(listed({ messageSubagent: false })?.sessions[0]?.capabilities?.messageSubagent, false)
  assert.equal(listed({ messageSubagent: 'yes' })?.sessions[0]?.capabilities?.messageSubagent, undefined)
  assert.equal(listed({})?.sessions[0]?.capabilities?.messageSubagent, undefined)
})

test('the origin reason and the lane’s record are read back, and a malformed one is nothing', () => {
  assert.deepEqual(readConversationMessageOrigin({ kind: 'studio', reason: 'agent-message' }), {
    kind: 'studio',
    reason: 'agent-message',
  })
  assert.deepEqual(readConversationSubagentMessage({ toolUseId: 't', text: 'Hi' }), { toolUseId: 't', text: 'Hi' })
  assert.equal(readConversationSubagentMessage({ toolUseId: 't' }), null)
  assert.equal(readConversationSubagentMessage('Hi'), null)
})
