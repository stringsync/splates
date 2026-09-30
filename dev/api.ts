/**
 * The page's writes, each the same core function the CLI calls behind it:
 * `arbor reply`, `arbor unreply` and `arbor todo add`, `update` and `remove`.
 * Holding a reply open to edit has no command of its own: the CLI's `reply`
 * is one write, over before an agent could read half of it.
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

/** Takes back a reply its agent has not claimed yet. */
export async function unreply(task: string, question: string): Promise<void> {
	await json("/api/unreply", { task, question });
}

/** Holds a reply while it is open to edit, so its agent cannot claim it. */
export async function holdReply(task: string, question: string): Promise<void> {
	await json("/api/reply/hold", { task, question });
}

export async function releaseReply(
	task: string,
	question: string,
): Promise<void> {
	await json("/api/reply/release", { task, question });
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
