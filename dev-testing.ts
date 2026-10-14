import { OpenPortProvider } from "webappwiz/system";
import { dev } from "./dev";
import type { Snapshot } from "./snapshot";
import type { Testing } from "./testing";

export async function readUntil(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	needle: string,
): Promise<string> {
	let text = "";
	while (!text.includes(needle)) {
		const { value, done } = await reader.read();
		if (done) {
			break;
		}
		text += new TextDecoder().decode(value);
	}
	return text;
}

/**
 * Whether `reader` says `needle` within `ms`. A server that could watch the
 * repo never polls it, so a change it hears of there came from a watch,
 * however long a loaded machine took to tell it.
 */
export async function within(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	needle: string,
	ms: number,
): Promise<boolean> {
	const deadline = Bun.sleep(ms).then(() => false);
	return Promise.race([
		readUntil(reader, needle).then((text) => text.includes(needle)),
		deadline,
	]);
}

/**
 * Serves `deps` on any port, so concurrent test files cannot collide on a
 * fixed one, for as long as `body` runs.
 */
export async function serving(
	deps: Testing,
	body: (snapshot: () => Promise<Snapshot>, port: number) => Promise<void>,
): Promise<void> {
	const server = await dev(deps, { ports: OpenPortProvider.any() });
	try {
		await body(
			async () =>
				(await (
					await fetch(`http://localhost:${server.port}/api/snapshot`)
				).json()) as Snapshot,
			server.port,
		);
	} finally {
		await server.disposeAsync();
	}
}

/** A JSON write the way the page makes one: same origin as the host it asked. */
export function json(
	port: number,
	path: string,
	method: string,
	body = {},
): Promise<Response> {
	return fetch(`http://127.0.0.1:${port}${path}`, {
		method,
		headers: {
			origin: `http://127.0.0.1:${port}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

/** A post the way the page makes one: same origin as the host it asked. */
export function post(
	port: number,
	path: string,
	body: BodyInit,
	headers = {},
): Promise<Response> {
	return fetch(`http://127.0.0.1:${port}${path}`, {
		method: "POST",
		headers: { origin: `http://127.0.0.1:${port}`, ...headers },
		body,
	});
}

/** A todo write the way the page makes one. */
export function todoForm(
	subject: string | null,
	files: File[] = [],
	keep: string[] = [],
): FormData {
	const form = new FormData();
	if (subject !== null) {
		form.set("subject", subject);
	}
	for (const file of files) {
		form.append("file", file);
	}
	for (const path of keep) {
		form.append("keep", path);
	}
	return form;
}
