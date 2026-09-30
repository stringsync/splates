/**
 * The page's writes. Replies and messages are the page's alone, with no CLI
 * command behind them, so no agent is tempted to message another; todos are
 * the same core functions as `arbor todo add`, `update` and `remove`.
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

/** A reply or a todo's files: new ones to add, and the stored ones to keep. */
export interface FilesForm {
	files: File[];
	/** Paths of files already stored to keep; the rest are dropped. */
	keep: string[];
}

export interface ReplyForm extends FilesForm {
	task: string;
	question: string;
	/** The keys of the choices picked; none for words alone. */
	choices: string[];
	text: string;
}

export async function reply({
	task,
	question,
	choices,
	text,
	files,
	keep,
}: ReplyForm): Promise<void> {
	const form = filesForm({ files, keep });
	form.set("task", task);
	form.set("question", question);
	for (const choice of choices) {
		form.append("choice", choice);
	}
	form.set("text", text);
	await send("/api/reply", { body: form });
}

export interface MessageForm extends FilesForm {
	task: string;
	/** The message to change, still unclaimed; absent for a new one. */
	id?: string;
	/** The question it follows up, like `Q3`. */
	about?: string | null;
	text: string;
}

/** Tells a task's agent something, or changes a message it has yet to read. */
export async function message({
	task,
	id,
	about,
	text,
	files,
	keep,
}: MessageForm): Promise<void> {
	const form = filesForm({ files, keep });
	form.set("task", task);
	if (id !== undefined) {
		form.set("id", id);
	}
	if (about) {
		form.set("about", about);
	}
	form.set("text", text);
	await send("/api/message", { body: form });
}

/** Takes back a reply or a message its agent has not claimed yet. */
export async function withdraw(task: string, id: string): Promise<void> {
	await json("/api/withdraw", { task, id });
}

/** Holds something sent while it is open to edit, so its agent cannot claim it. */
export async function hold(task: string, id: string): Promise<void> {
	await json("/api/hold", { task, id });
}

export async function release(task: string, id: string): Promise<void> {
	await json("/api/release", { task, id });
}

export async function addTodo(text: string, files: File[]): Promise<void> {
	const form = filesForm({ files, keep: [] });
	form.set("text", text);
	await send("/api/todos", { body: form });
}

export async function updateTodo(
	id: number,
	{ text, files, keep }: FilesForm & { text: string },
): Promise<void> {
	const form = filesForm({ files, keep });
	form.set("text", text);
	await send(`/api/todos/${id}`, { method: "PATCH", body: form });
}

export async function removeTodo(id: number): Promise<void> {
	await send(`/api/todos/${id}`, { method: "DELETE" });
}

/**
 * Where the page loads a stored file: one a reply or a todo holds, or an
 * image a question of `task` shows.
 */
export function fileUrl(path: string, task = ""): string {
	return `/api/file?${new URLSearchParams({ task, path })}`;
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

async function json(path: string, body: unknown): Promise<void> {
	await send(path, {
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
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
