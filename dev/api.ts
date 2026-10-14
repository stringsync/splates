/**
 * The page's writes: the same core functions as `arbor todo add`, `update`
 * and `remove`, and the lanes' own.
 * A refusal comes back as the CLI's own reason and message, thrown so the
 * caller can show it.
 */

import type {
	After,
	Answer,
	Attached,
	Checkpoint,
	ConversationState,
	Image,
	Session,
} from "../conversations";
import type { FileDiff } from "../diff";
import type { Held } from "../held";
import type { Behind } from "../release";
import type { AgentPick } from "../roster";
import type { Stats } from "../stats";
import type { NamedSystem } from "../systems";

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
 * for the one `arbor dev` started in, unless `path` names one itself. Every
 * request the page makes goes through here.
 */
export function scoped(path: string): string {
	const project = new URLSearchParams(location.search).get("project");
	if (project === null || project === "" || path.includes("project=")) {
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
			body.message ??
				(response.status === 413
					? "too big to send"
					: `${path}: ${response.status}`),
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

/** Has `assignee` work todo `id`, or nobody in particular for null. */
export async function assignTodo(
	id: number,
	assignee: AgentPick | null,
): Promise<void> {
	await sendJson(
		`/api/todos/${id}/assignee`,
		"PUT",
		assignee ?? { agent: null },
	);
}

/** Has `assignee` work lane `id`, or nobody in particular for null. */
export async function assignLane(
	id: number,
	assignee: AgentPick | null,
): Promise<void> {
	await sendJson(
		`/api/lanes/${id}/assignee`,
		"PUT",
		assignee ?? { agent: null },
	);
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

/** Every system `task`'s worktree names, or the main tree's for none. */
export async function systems(task = ""): Promise<NamedSystem[]> {
	const response = await fetch(
		scoped(`/api/systems?${new URLSearchParams({ task })}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/systems: ${response.status}`);
	}
	return (await response.json()) as NamedSystem[];
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
 * `arbor remove` for `task`, past any lease, stopping each conversation in
 * its tree and moving it to the main tree.
 */
export async function removeTask(task: string): Promise<void> {
	await send(`/api/tasks/${encodeURIComponent(task)}`, { method: "DELETE" });
}

/**
 * Starts a conversation with `agent`, in `task`'s tree or the main tree for
 * null, with `settings` (by id) set once its session offers them.
 */
export async function startConversation(
	agent: string,
	task: string | null,
	settings: Record<string, string> = {},
	/** The model to start on, by its id on the roster. */
	model?: string,
): Promise<ConversationState> {
	return (await sendJson("/api/conversations", "POST", {
		agent,
		task,
		settings,
		...(model === undefined ? {} : { model }),
	})) as ConversationState;
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

/** Says `text` to the agent in conversation `id`, with `files`. */
export async function promptConversation(
	id: string,
	text: string,
	files: File[] = [],
): Promise<void> {
	const form = new FormData();
	form.set("text", text);
	for (const file of files) {
		form.append("file", file, file.name);
	}
	await send(`/api/conversations/${id}/prompt`, { body: form });
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

/** `path` for the project `slug` names, whichever one the page shows. */
function inProject(path: string, slug: string): string {
	return `${path}?${new URLSearchParams({ project: slug })}`;
}

/**
 * Asks every live conversation in each of `projects`, by slug, or only those
 * `conversations` names by id, to bring its `ARBOR.md` up to date and stop,
 * each saying how it gets on in its `checkpoint`, and then does what `after`
 * says: a restart waits on them all.
 */
export async function checkpointProjects(
	projects: string[],
	after: After,
	conversations?: string[],
): Promise<void> {
	await sendJson("/api/checkpoint", "POST", {
		projects,
		after,
		...(conversations === undefined ? {} : { conversations }),
	});
}

/**
 * Tells each agent done with the checkpoint, in every project, to carry on,
 * and forgets the checkpoint of those it missed.
 */
export async function resumeCheckpoint(): Promise<void> {
	await send("/api/checkpoint/resume", {});
}

/**
 * Restarts `arbor dev` now, each agent done with the checkpoint carrying on
 * once served again.
 */
export async function restartFromCheckpoint(): Promise<void> {
	await send("/api/checkpoint/restart", {});
}

/**
 * Restarts `arbor dev` now, as when every agent is idle: refused while one
 * is at work.
 */
export async function restartIdle(): Promise<void> {
	await send("/api/restart", {});
}

/** Forgets project `slug`'s checkpoint, so the next one starts afresh. */
export async function dismissCheckpoint(slug: string): Promise<void> {
	await send(inProject("/api/conversations/checkpoint", slug), {
		method: "DELETE",
	});
}

/** Stops the agent's turn in conversation `id`, keeping the conversation. */
export async function cancelConversation(id: string): Promise<void> {
	await send(`/api/conversations/${id}/cancel`, {});
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
	/** Its live conversations, and those a checkpoint has asked. */
	conversations: ProjectConversation[];
	/** How many of its agents wait on you. */
	waiting: number;
}

/** A conversation a checkpoint of its project asks, or has asked. */
export interface ProjectConversation {
	id: string;
	name: string;
	status: string;
	/** Where its checkpoint stands; null when none was asked for. */
	checkpoint: Checkpoint | null;
}

/** The projects on this machine, and the `arbor dev` serving them. */
export interface Projects {
	/** Every arbor project, in the order each joined. */
	projects: ProjectChoice[];
	/**
	 * The restart to follow the checkpoint under way, and whether the next
	 * run resumes its agents; null for none.
	 */
	restarting: { resume: boolean } | null;
	/**
	 * How this run began, when a checkpoint's restart started it: its agents
	 * `waiting` to be resumed, or `resuming`, told to carry on, until each has.
	 */
	restarted: "waiting" | "resuming" | null;
	/** This run of `arbor dev`: another once it has restarted. */
	run: string;
	/** The version of arbor it runs. */
	running: string;
	/** A newer arbor, which a restart lands on; null when none is out. */
	newest: string | null;
	/** Commits to arbor's own source since this run started from it. */
	behind: Behind | null;
	/** Whether `arbor dev` can restart itself, as under its supervisor. */
	restartable: boolean;
	/**
	 * What a restart would kill, which holds an auto restart off: jobs in
	 * front in the page's shells, and commands idle agents left running.
	 */
	held: Held[];
}

/** Every arbor project on this machine, and the `arbor dev` serving them. */
export async function listProjects(): Promise<Projects> {
	const response = await fetch("/api/projects");
	if (!response.ok) {
		throw new ApiError("error", `/api/projects: ${response.status}`);
	}
	return (await response.json()) as Projects;
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

/**
 * How tasks ended across every project, summed for the Stats page over the
 * last `weeks`, or all time for null.
 */
export async function stats(weeks: number | null): Promise<Stats> {
	const path = `/api/stats?weeks=${weeks ?? "all"}`;
	const response = await fetch(path);
	if (!response.ok) {
		throw new ApiError("error", `${path}: ${response.status}`);
	}
	return (await response.json()) as Stats;
}
