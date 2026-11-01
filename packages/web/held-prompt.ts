import type { Message } from "@stringsync/splates-server/conversations";
import { SERVER_TOLD } from "@stringsync/splates-server/conversations/browser";
import { taskNumberReference } from "@stringsync/splates-server/plans/browser";

/**
 * What the conversation held for queued task `id` will ask its agent, as
 * splates says it, queued since the conversation began.
 */
export function heldPrompt(id: number, at: string): Message {
	return {
		role: "user",
		parts: [{ type: "text", text: taskNumberReference(id) }],
		plan: null,
		at,
		until: at,
		queued: true,
		told: SERVER_TOLD,
	};
}
