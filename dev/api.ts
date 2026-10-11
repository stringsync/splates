/**
 * The page's writes: the same core functions as `arbor todo add`, `update`
 * and `remove`, and the lanes' own.
 * A refusal comes back as the CLI's own reason and message, thrown so the
 * caller can show it.
 */

import type {
	After,
	Answer,
	Checkpoint,
	ConversationState,
	Image,
} from "../conversations";
import type { FileDiff } from "../diff";

export class ApiError extends Error {
	constructor(
		readonly reason: string,
		message: string,
	) {
		super(message);
	}
}

/**
 * `path` for the project this page shows: the one `?project=` names, or none
 * for the one `arbor dev` started in. Every request the page makes goes
 * through here.
 */
export function scoped(path: string): string {
	const project = new URLSearchParams(location.search).get("project");
	if (project === null || project === "") {
		return path;
	}
	const query = new URLSearchParams({ project });
	return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

async function send(path: string, init: RequestInit): Promise<unknown> {
	const response = await fetch(scoped(path), { method: "POST", ...init });
	const body = (await response.json().catch(() => ({}))) as {
		reason?: string;
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `${path}: ${response.status}`,
		);
	}
	return body;
}

/** A todo's files: new ones to add, and the stored ones to keep. */
export interface FilesForm {
	files: File[];
	/** Paths of files already stored to keep; the rest are dropped. */
	keep: string[];
}

/** What a todo says: a line, and whatever more there is to say. */
export interface TodoForm {
	subject: string;
	text: string;
	/** Where it goes in the list, 1 at the top; absent leaves it be. */
	position?: number;
}

/** Adds a todo at the bottom of `lane`, or of the untriaged ones for null. */
export async function addTodo(
	{ subject, text, position }: TodoForm,
	files: File[],
	lane: number | null = null,
): Promise<void> {
	const form = filesForm({ files, keep: [] });
	todoForm(form, { subject, text, position });
	if (lane !== null) {
		form.set("lane", String(lane));
	}
	await send("/api/todos", { body: form });
}

export async function updateTodo(
	id: number,
	{ subject, text, position, files, keep }: FilesForm & TodoForm,
): Promise<void> {
	const form = filesForm({ files, keep });
	todoForm(form, { subject, text, position });
	await send(`/api/todos/${id}`, { method: "PATCH", body: form });
}

/** Puts a todo at `position`, 1 at the top, moving the rest around it. */
export async function moveTodo(id: number, position: number): Promise<void> {
	await sendJson(`/api/todos/${id}/position`, "PUT", { position });
}

function sendJson(path: string, method: string, body: unknown) {
	return send(path, {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** Says `id` is blocked by exactly the todos in `blockedBy`, no more and no fewer. */
export async function linkTodo(id: number, blockedBy: number[]): Promise<void> {
	await sendJson(`/api/todos/${id}/blocked-by`, "PUT", { blockedBy });
}

/**
 * Puts a todo in `lane` (`"new"` for one of its own, null for none), just
 * above the todo `before`, or at the bottom of the lane without one.
 */
export async function arrangeTodo(
	id: number,
	lane: number | "new" | null,
	before?: number,
	/** What to call a new lane; named after the todo without one. */
	name?: string,
): Promise<void> {
	await sendJson(`/api/todos/${id}/lane`, "PUT", { lane, before, name });
}

/** Moves lane `from`'s todos to the bottom of lane `into`. */
export async function joinLanes(from: number, into: number): Promise<void> {
	await sendJson(`/api/lanes/${from}/join`, "POST", { into });
}

/** Starts an empty lane called `name`, after the others. */
export async function addLane(name: string): Promise<void> {
	await sendJson("/api/lanes", "POST", { name });
}

/** Calls lane `id` by another name. */
export async function renameLane(id: number, name: string): Promise<void> {
	await sendJson(`/api/lanes/${id}`, "PUT", { name });
}

/** Puts lane `id` at `position` among the lanes, 1 the first column. */
export async function moveLane(id: number, position: number): Promise<void> {
	await sendJson(`/api/lanes/${id}`, "PUT", { position });
}

/** Removes lane `id`, putting its todos back with the untriaged ones. */
export async function dropLane(id: number): Promise<void> {
	await send(`/api/lanes/${id}`, { method: "DELETE" });
}

export async function removeTodo(id: number): Promise<void> {
	await send(`/api/todos/${id}`, { method: "DELETE" });
}

/** Where the page loads a file a todo holds. */
export function fileUrl(path: string): string {
	return scoped(`/api/file?${new URLSearchParams({ path })}`);
}

function todoForm(form: FormData, { subject, text, position }: TodoForm): void {
	form.set("subject", subject);
	form.set("text", text);
	if (position !== undefined) {
		form.set("position", String(position));
	}
}

function filesForm({ files, keep }: FilesForm): FormData {
	const form = new FormData();
	for (const file of files) {
		form.append("file", file, file.name);
	}
	for (const path of keep) {
		form.append("keep", path);
	}
	return form;
}

/**
 * The files and directories (ending in `/`) a task's tree holds, or the main
 * tree's for none: what `@` offers.
 */
export async function paths(task = ""): Promise<string[]> {
	const response = await fetch(
		scoped(`/api/paths?${new URLSearchParams({ task })}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/paths: ${response.status}`);
	}
	return (await response.json()) as string[];
}

/** What `task` changed against its base, uncommitted edits included. */
export async function taskDiff(task: string): Promise<FileDiff[]> {
	const response = await fetch(
		scoped(`/api/tasks/${encodeURIComponent(task)}/diff`),
	);
	if (!response.ok) {
		throw new ApiError("error", `${task}'s diff: ${response.status}`);
	}
	return (await response.json()) as FileDiff[];
}

/**
 * Gives `task`, escalated once it spent its merge attempts, another round of
 * them, as `arbor retry` does.
 */
export async function retryTask(task: string): Promise<void> {
	await send(`/api/tasks/${encodeURIComponent(task)}/retry`, {});
}

/**
 * Starts a conversation with `agent`, in `task`'s tree or the main tree for
 * null, with `settings` (by id) set once its session offers them.
 */
export async function startConversation(
	agent: string,
	task: string | null,
	settings: Record<string, string> = {},
): Promise<ConversationState> {
	return (await sendJson("/api/conversations", "POST", {
		agent,
		task,
		settings,
	})) as ConversationState;
}

/** Says `text` to the agent in conversation `id`, with `images`. */
export async function promptConversation(
	id: string,
	text: string,
	images: File[] = [],
): Promise<void> {
	await sendJson(`/api/conversations/${id}/prompt`, "POST", {
		text,
		...(images.length === 0
			? {}
			: {
					images: await Promise.all(
						images.map(async (file) => ({
							mimeType: file.type,
							data: (await dataUrl(file)).split(",")[1] ?? "",
						})),
					),
				}),
	});
}

/** `file` as a `data:` URL, its bytes in base64 after the comma. */
function dataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

/** Where the page reads `image`, one the person sent in conversation `id`. */
export function conversationImage(id: string, image: Image): string {
	return scoped(
		`/api/conversations/${id}/images/${encodeURIComponent(image.name)}`,
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

/**
 * Asks every live conversation in this project to bring its `ARBOR.md` up to
 * date and stop, each saying how it gets on in its `checkpoint`, and then
 * does what `after` says: for a restart, every project's are asked.
 */
export async function checkpointConversations(after: After): Promise<void> {
	await sendJson("/api/conversations/checkpoint", "POST", { after });
}

/** Tells each agent a checkpoint stopped in this project to carry on. */
export async function resumeConversations(): Promise<void> {
	await send("/api/conversations/resume", {});
}

/** Forgets this project's checkpoint, so the next one starts afresh. */
export async function dismissCheckpoint(): Promise<void> {
	await send("/api/conversations/checkpoint", { method: "DELETE" });
}

/** Stops the agent's turn in conversation `id`, keeping the conversation. */
export async function cancelConversation(id: string): Promise<void> {
	await send(`/api/conversations/${id}/cancel`, {});
}

/**
 * Takes back the `index`th message queued in conversation `id`, answering
 * with its words and images.
 */
export async function unqueueConversation(
	id: string,
	index: number,
): Promise<{ text: string; images: File[] }> {
	const { text, images } = (await sendJson(
		`/api/conversations/${id}/unqueue`,
		"POST",
		{ index },
	)) as { text: string; images: Image[] };
	return {
		text,
		images: await Promise.all(
			images.map(async (image) => {
				const response = await fetch(conversationImage(id, image));
				return new File([await response.blob()], image.name, {
					type: image.mimeType,
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

/** Names conversation `id` `name`, or back to the agent's title when blank. */
export async function renameConversation(
	id: string,
	name: string,
): Promise<void> {
	await sendJson(`/api/conversations/${id}/name`, "PUT", { name });
}

/** Puts conversation `id` away, stopping its agent, or back on the list. */
export async function archiveConversation(
	id: string,
	archived: boolean,
): Promise<void> {
	await sendJson(`/api/conversations/${id}/archived`, "PUT", { archived });
}

/** A project the page can switch to, from the registry. */
export interface ProjectChoice {
	slug: string;
	root: string;
	/** Its repository moved or was deleted: it cannot be opened. */
	gone: boolean;
	/** The one `arbor dev` runs in, which the page shows with no `?project=`. */
	here: boolean;
}

/** Every arbor project on this machine, in the order each joined. */
export async function listProjects(): Promise<ProjectChoice[]> {
	const response = await fetch("/api/projects");
	if (!response.ok) {
		throw new ApiError("error", `/api/projects: ${response.status}`);
	}
	return ((await response.json()) as { projects: ProjectChoice[] }).projects;
}

/** Drops a project from the registry, as for one that is gone for good. */
export async function forgetProject(slug: string): Promise<void> {
	await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
		method: "DELETE",
	}).then(async (response) => {
		if (!response.ok) {
			const body = (await response.json().catch(() => ({}))) as {
				reason?: string;
				message?: string;
			};
			throw new ApiError(
				body.reason ?? "error",
				body.message ?? "not forgotten",
			);
		}
	});
}

/** A live conversation, whose agent a restart of `arbor dev` would stop. */
export interface Interrupted {
	/** The project it runs in, by the slug `?project=` names it with. */
	project: string;
	id: string;
	name: string;
	status: string;
	/** Where its checkpoint stands; null when none was asked for. */
	checkpoint: Checkpoint | null;
}

/** What a restart would bring, and what it would stop right now. */
export interface ReleaseState {
	running: string;
	newest: string | null;
	interrupted: Interrupted[];
}

/** Asked as the hint opens, so its list is the one a restart would stop then. */
export async function showRelease(): Promise<ReleaseState> {
	const response = await fetch("/api/release");
	if (!response.ok) {
		throw new ApiError("error", `/api/release: ${response.status}`);
	}
	return (await response.json()) as ReleaseState;
}

/**
 * Asks every live conversation, in every project, to bring its `ARBOR.md` up
 * to date and stop, for `showRelease` to say how each is getting on.
 */
export async function checkpointAll(): Promise<void> {
	await send("/api/release/checkpoint", {});
}
