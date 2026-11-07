import { useLocalChatBinding } from '../../../panels/agentChat/chatBinding'
import { useRemoteChat } from '../../../panels/agentChat/remoteChatRegistry'
import { useWorkspaceStore } from '../../../../store/workspaceStore'

/**
 * The chat in the tab the panel is about: the workspace's focused chat, or, for
 * a chat on a paired machine, which has no record here and records no focus, the
 * one its pane says is open here. The Library finds its chat the same way. The
 * panel then follows the agent in view in that tab.
 */
export function useChatPanelTarget(workspaceId: string): string | null {
  const focusedAgentId = useWorkspaceStore((state) => state.focusedAgentByWorkspaceId[workspaceId] ?? null)
  const local = useLocalChatBinding(workspaceId, focusedAgentId ?? '')
  const remote = useRemoteChat(workspaceId, local ? null : focusedAgentId)
  const anyRemote = useRemoteChat(workspaceId, null)
  if (local) return focusedAgentId
  return (remote ?? anyRemote)?.agentId ?? focusedAgentId
}
