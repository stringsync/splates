/**
 * The page's two writes, each the same core function the CLI calls behind it:
 * `arbor reply` and `arbor todo add`. A refusal comes back as the CLI's own
 * reason and message, thrown so the caller can show it.
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

export interface ReplyForm {
	task: string;
	question: string;
	/** The keys of the choices picked; none for words alone. */
	choices: string[];
	text: string;
	files: File[];
}

export async function reply({
	task,
	question,
	choices,
	text,
	files,
}: ReplyForm): Promise<void> {
	const form = new FormData();
	form.set("task", task);
	form.set("question", question);
	for (const choice of choices) {
		form.append("choice", choice);
	}
	form.set("text", text);
	for (const file of files) {
		form.append("file", file, file.name);
	}
	await send("/api/reply", { body: form });
}

export async function addTodo(text: string): Promise<void> {
	await send("/api/todos", {
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ text }),
	});
}

/** Where the page loads an image a question shows. */
export function imageUrl(task: string, path: string): string {
	return `/api/image?${new URLSearchParams({ task, path })}`;
}
