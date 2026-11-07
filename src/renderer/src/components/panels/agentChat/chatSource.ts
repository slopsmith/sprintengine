import { useLocalChatBinding, type ChatBinding } from './chatBinding'
import type { ConversationTransport } from './conversationTransport'
import { useRemoteChat, type RemoteChatEntry } from './remoteChatRegistry'

// How to read a chat from outside its own view, wherever it runs: a chat here is
// found by its record, and a chat on a paired machine by the pane that says it
// is open here, or by its parent's when it is a sub-agent over there with no
// pane of its own yet.

export type ChatSource = {
  binding: ChatBinding
  /** What its session is keyed by. */
  root: string
  /** The transport to read it through; null for a chat here, read through the tree's. */
  transport: ConversationTransport | null
  /** Its entry, for a chat on a paired machine. */
  remote: RemoteChatEntry | null
}

export function useChatSource(workspaceId: string, agentId: string | null): ChatSource | null {
  const local = useLocalChatBinding(workspaceId, agentId ?? '')
  const remote = useRemoteChat(workspaceId, local || !agentId ? null : agentId)
  const binding = local ?? remote?.binding ?? null
  const root = binding ? (binding.sessionRoot ?? binding.workspaceRoot) : null
  if (!agentId || !binding || !root) return null
  if (!remote || local) return { binding, root, transport: null, remote: null }
  const transport = remote.agentId === agentId ? remote.transport : remote.subagentTransport(agentId)
  return { binding, root, transport, remote }
}
