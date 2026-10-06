/**
 * The page's writes: the same core functions as `arbor todo add`, `update`
 * and `remove`, and the lanes' own.
 * A refusal comes back as the CLI's own reason and message, thrown so the
 * caller can show it.
 */

export class ApiError extends Error {
	constructor(
		readonly reason: string,
		message: string,
	) {
		super(message);
	}
}

async function send(path: string, init: RequestInit): Promise<unknown> {
	const response = await fetch(path, { method: "POST", ...init });
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
	return `/api/file?${new URLSearchParams({ path })}`;
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
	const response = await fetch(`/api/paths?${new URLSearchParams({ task })}`);
	if (!response.ok) {
		throw new ApiError("error", `/api/paths: ${response.status}`);
	}
	return (await response.json()) as string[];
}
