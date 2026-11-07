import { canvasContinuePrompt } from '../../shared/canvas/paths'
import { canvasFail, canvasOk } from '../../shared/canvas/types'
import type { CanvasContinueInput, CanvasContinueResult, CanvasResult } from '../../shared/canvas/types'
import { isMachinePath } from '../../shared/machine-paths'
import type { ConversationLaunchRequest, ConversationLaunchResult } from '../conversation-launch-service'

// "Continue in a new chat" on a board: a chat whose first message names the
// board by its id, so it picks up the same file wherever it runs.
//
// It starts beside the board where it can, in the folder the board was drawn
// in, because that is what the person will want to talk about. Where that
// folder is gone (a worktree handed back, a project removed) the board is still
// there, and any chat can reach it by id: it starts in the project of the chat
// that asked, and failing that under no project. A folder that went away is
// never a reason to refuse the board.

export type CanvasBoardChatDeps = {
  /** A workspace's folder here, or null when it has none. */
  folderOf: (workspaceId: string) => string | null
  /** Whether a folder is on this disk. */
  folderExists: (folder: string) => Promise<boolean>
  launch: (request: ConversationLaunchRequest) => Promise<ConversationLaunchResult>
  /** A folder of its own for a chat under no project. */
  newProjectlessFolder: (prompt: string) => Promise<string>
}

export async function continueCanvasBoardInNewChat(
  deps: CanvasBoardChatDeps,
  input: CanvasContinueInput,
): Promise<CanvasResult<CanvasContinueResult>> {
  const prompt = canvasContinuePrompt(input.name, input.id)
  const usable = async (workspaceId: string | null | undefined): Promise<boolean> => {
    const folder = workspaceId ? deps.folderOf(workspaceId) : null
    // A folder on another machine (an SSH project) cannot be checked from here.
    return folder !== null && (isMachinePath(folder) || (await deps.folderExists(folder)))
  }
  const beside = (await usable(input.boardWorkspaceId))
    ? input.boardWorkspaceId
    : (await usable(input.workspaceId))
      ? input.workspaceId
      : null
  const launched = await deps.launch(
    beside
      ? { workspaceId: beside, newChat: true, prompt }
      : { newChatIn: { folderPath: await deps.newProjectlessFolder(prompt) }, prompt },
  )
  if (!launched.ok) return canvasFail('forbidden', launched.message)
  return canvasOk({ workspaceId: launched.workspaceId, agentId: launched.agentId })
}
