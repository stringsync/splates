import type { AgentPick } from "@stringsync/splates-server/models";
import { scoped, send, sendJson } from "./request";

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

/** Puts queued todo `id` at `position` in the queue, 1 the next to start. */
export async function moveInQueue(id: number, position: number): Promise<void> {
	await sendJson(`/api/todos/${id}/queue-position`, "PUT", { position });
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

/** Has only the person queue todo `id`, a queued lane passing over it, or lets a lane queue it. */
export async function manualTodo(id: number, manual: boolean): Promise<void> {
	await sendJson(`/api/todos/${id}/manual`, "PUT", { manual });
}

/**
 * Puts todo `id` in the queue, for a worker to start once nothing it is
 * blocked by is open, or takes it out, back to the backlog. Given
 * `project`, a slug, that project's todo `id` instead of this page's.
 */
export async function queueTodo(
	id: number,
	queued: boolean,
	project: string | null = null,
): Promise<void> {
	await sendJson(scoped(`/api/todos/${id}/queued`, project), "PUT", {
		queued,
	});
}

/** Records `answer` to question `index` of todo `id`'s deferral. */
export async function answerDeferral(
	id: number,
	index: number,
	answer: string,
): Promise<void> {
	await sendJson(`/api/todos/${id}/deferral/answer`, "PUT", { index, answer });
}

/** Marks what todo `id`'s deferral waits on outside splates, `index`, as done. */
export async function finishOutside(id: number, index: number): Promise<void> {
	await sendJson(`/api/todos/${id}/deferral/outside`, "PUT", { index });
}

/** Tries queued todo `id`'s start again, after its start was refused. */
export async function retryQueuedStart(id: number): Promise<void> {
	await send(`/api/todos/${id}/retry`, {});
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

/**
 * Queues lane `id` whole, each of its todos as nothing blocks it, or stops,
 * unqueueing those yet to start.
 */
export async function queueLane(id: number, queued: boolean): Promise<void> {
	await sendJson(`/api/lanes/${id}`, "PUT", { queued });
}

/** Lets queued lane `id` queue `more` tasks on its own, beyond its budget left. */
export async function approveLane(id: number, more: number): Promise<void> {
	await sendJson(`/api/lanes/${id}`, "PUT", { approve: more });
}

/** Removes lane `id` and the todos in it. */
export async function dropLane(id: number): Promise<void> {
	await send(`/api/lanes/${id}`, { method: "DELETE" });
}

/** Removes a todo, kept for `restoreTodo` to put back. */
export async function removeTodo(id: number): Promise<void> {
	await send(`/api/todos/${id}`, { method: "DELETE" });
}

/** Puts back a todo `removeTodo` removed, under its id, where it stood. */
export async function restoreTodo(id: number): Promise<void> {
	await send(`/api/todos/${id}/restore`, { method: "POST" });
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
