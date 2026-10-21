/**
 * The page's calls on conversations: starting and bringing them in,
 * prompting, answering and cancelling them, their queued messages and
 * settings, and renaming, marking and archiving them.
 */

import type {
	Answer,
	Attached,
	ConversationState,
	Image,
	Session,
} from "@stringsync/splates-server/conversations";
import { FROM_HEADER } from "@stringsync/splates-server/conversations/browser";
import { scoped, send, sendJson } from "./api";
import { WIDE } from "./app-nav";

/**
 * Starts a conversation with `agent`, in `task`'s tree or the main tree for
 * null, with `settings` (by id) set once its session offers them.
 */
export async function startConversation(
	agent: string,
	task: string | null,
	{
		settings = {},
		model,
		assigned = false,
		id,
	}: {
		settings?: Record<string, string>;
		/** The model to start on, by its id on the roster. */
		model?: string;
		/**
		 * Whether a todo assigned the agent and model, so a new conversation does
		 * not start where this one leaves its settings.
		 */
		assigned?: boolean;
		/** The id it starts on, picked by the page to open it at once; the server's otherwise. */
		id?: string;
	} = {},
): Promise<ConversationState> {
	return (await sendJson("/api/conversations", "POST", {
		...(id === undefined ? {} : { id }),
		agent,
		task,
		settings,
		...(model === undefined ? {} : { model }),
		...(assigned ? { assigned } : {}),
	})) as ConversationState;
}

/** A new conversation's first message for Auto pick to judge, in `task`'s tree or the main tree for null. */
export interface AutoWords {
	attachments?: { name: string; mimeType: string }[];
	words: string;
	task: string | null;
	/** The id it starts on, picked by the page to open it at once. */
	id?: string;
}

/**
 * Starts a conversation on what Auto pick decides for a task: a started one
 * by name, in its tree, or a queued one by number, in the main tree. The
 * server answers before the judge does, on the rule for any task, and moves
 * it onto the pick before its agent opens; the page sends the prompt as for
 * any start.
 */
export async function startAutoPick(
	target: { task: string } | { todo: number } | AutoWords,
): Promise<ConversationState> {
	return (await sendJson(
		"/api/conversations/auto",
		"POST",
		target,
	)) as ConversationState;
}

/**
 * The sessions the agents hold in `task`'s tree that no conversation does,
 * such as ones started in their CLI, newest first.
 */
export async function listSessions(task: string): Promise<Session[]> {
	return (await send(
		`/api/conversations/sessions?${new URLSearchParams({ task })}`,
		{ method: "GET" },
	)) as Session[];
}

/** Brings in `session`, one an agent holds, as a conversation in `task`'s tree. */
export async function bringSession(
	session: Session,
	task: string,
): Promise<ConversationState> {
	return (await sendJson("/api/conversations/sessions", "POST", {
		agent: session.agent,
		session: session.session,
		title: session.title,
		task,
	})) as ConversationState;
}

/**
 * Says `text` to the agent in conversation `id`, with `files`, and which
 * layout the page shows, so the Stats page can tell phone work from desktop.
 */
export async function promptConversation(
	id: string,
	text: string,
	files: File[] = [],
	/** Whether the person said it into the mic, which the agent is told. */
	dictated = false,
	/** The id the feed gave the copy it shows, which the server keeps on its own. */
	sent?: string,
	signal?: AbortSignal,
): Promise<ConversationState> {
	const form = new FormData();
	form.set("text", text);
	if (sent !== undefined) {
		form.set("id", sent);
	}
	if (dictated) {
		form.set("dictated", "true");
	}
	for (const file of files) {
		form.append("file", file, file.name);
	}
	return (await send(`/api/conversations/${id}/prompt`, {
		body: form,
		signal,
		headers: { [FROM_HEADER]: matchMedia(WIDE).matches ? "desktop" : "phone" },
	})) as ConversationState;
}

/** Where the page reads `file`, one the person sent in conversation `id`. */
export function conversationAttachment(id: string, file: Image): string {
	return (
		file.url ??
		scoped(
			`/api/conversations/${id}/attachments/${encodeURIComponent(file.name)}`,
		)
	);
}

/** Answers what the agent in conversation `id` is asking, by the ask's id. */
export async function answerConversation(
	id: string,
	ask: string,
	answer: Answer,
): Promise<void> {
	await sendJson(`/api/conversations/${id}/answer`, "POST", { ask, answer });
}

/** Stops the agent's turn in conversation `id`, keeping the conversation. */
export async function cancelConversation(id: string): Promise<void> {
	await send(`/api/conversations/${id}/cancel`, {});
}

/**
 * Checkpoints the agent of conversation `id` and leaves it stopped there,
 * without resuming.
 */
export async function pauseConversation(id: string): Promise<void> {
	await send(`/api/conversations/${id}/pause`, {});
}

/**
 * Starts the agent of conversation `id` again in a new session on its task,
 * told to claim it, for one stuck or dead there.
 */
export async function restartConversation(id: string): Promise<void> {
	await send(`/api/conversations/${id}/restart`, {});
}

/**
 * Takes conversation `id` off its task, its agent stopped, and answers the
 * prompt that has the next agent claim the task.
 */
export async function handOffConversation(id: string): Promise<string> {
	const { prompt } = (await send(`/api/conversations/${id}/hand-off`, {})) as {
		prompt: string;
	};
	return prompt;
}

/** Stops command `background` the agent in conversation `id` left running. */
export async function stopBackground(
	id: string,
	background: string,
): Promise<void> {
	await sendJson(`/api/conversations/${id}/stop-background`, "POST", {
		background,
	});
}

/**
 * Takes back the `index`th message queued in conversation `id`, answering
 * with its words and images.
 */
export async function unqueueConversation(
	id: string,
	index: number,
): Promise<{ text: string; files: File[] }> {
	const { text, files } = (await sendJson(
		`/api/conversations/${id}/unqueue`,
		"POST",
		{ index },
	)) as { text: string; files: Attached[] };
	return {
		text,
		files: await Promise.all(
			files.map(async (file) => {
				const response = await fetch(conversationAttachment(id, file));
				return new File([await response.blob()], file.title, {
					type: file.mimeType,
				});
			}),
		),
	};
}

/** Sends what is queued in conversation `id` now, stopping its turn. */
export async function sendQueuedNow(id: string): Promise<void> {
	await send(`/api/conversations/${id}/send-now`, {});
}

/** Switches conversation `id` to `model`. */
export async function chooseSetting(
	id: string,
	setting: string,
	value: string,
): Promise<void> {
	await sendJson(`/api/conversations/${id}/setting`, "PUT", {
		id: setting,
		value,
	});
}

/** Switches Auto pick on or off for conversation `id`'s model and effort. */
export async function switchAutoPick(id: string, on: boolean): Promise<void> {
	await sendJson(`/api/conversations/${id}/auto-pick`, "PUT", { on });
}

/** Saves `value` for `agent`'s setting `setting` as what its new conversations start with. */
export async function chooseDefault(
	agent: string,
	setting: string,
	value: string,
): Promise<void> {
	await sendJson("/api/conversations/defaults", "PUT", {
		agent,
		id: setting,
		value,
	});
}

/** Names conversation `id` `name`, or back to the agent's title when blank. */
export async function renameConversation(
	id: string,
	name: string,
): Promise<void> {
	await sendJson(`/api/conversations/${id}/name`, "PUT", { name });
}

/** Marks conversation `id` seen, or unseen again. */
export async function markUnread(id: string, unread: boolean): Promise<void> {
	await sendJson(`/api/conversations/${id}/unread`, "PUT", { unread });
}

/** Tells the server the person has read `read` messages of conversation `id`. */
export async function markRead(id: string, read: number): Promise<void> {
	await sendJson(`/api/conversations/${id}/read`, "PUT", { read });
}

/** Keeps conversation `id` atop the list, or lets it go back among the rest. */
export async function pinConversation(
	id: string,
	pinned: boolean,
): Promise<void> {
	await sendJson(`/api/conversations/${id}/pinned`, "PUT", { pinned });
}

/**
 * Nests conversation `id` in the list under conversation `parent`, or at the
 * top for null.
 */
export async function reparentConversation(
	id: string,
	parent: string | null,
): Promise<void> {
	await sendJson(`/api/conversations/${id}/parent`, "PUT", { parent });
}

/** Puts conversation `id` away, stopping its agent, or back on the list. */
export async function archiveConversation(
	id: string,
	archived: boolean,
): Promise<void> {
	await sendJson(`/api/conversations/${id}/archived`, "PUT", { archived });
}

/** Where the page reads `version` of the artifact `name` of conversation `id`. */
export function conversationArtifact(
	id: string,
	name: string,
	version: number,
): string {
	return scoped(
		`/api/conversations/${id}/artifacts/${encodeURIComponent(name)}/${version}`,
	);
}

/** Deletes the bytes of `version` of the artifact `name` of conversation `id`. */
export async function deleteArtifactVersion(
	id: string,
	name: string,
	version: number,
): Promise<void> {
	await send(
		`/api/conversations/${id}/artifacts/${encodeURIComponent(name)}/${version}`,
		{ method: "DELETE" },
	);
}
