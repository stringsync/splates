/**
 * The page's writes: the same core functions as `arbor todo add`, `update`
 * and `remove`.
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

export async function addTodo(
	{ subject, text, position }: TodoForm,
	files: File[],
): Promise<void> {
	const form = filesForm({ files, keep: [] });
	todoForm(form, { subject, text, position });
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
	await send(`/api/todos/${id}/position`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ position }),
	});
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
