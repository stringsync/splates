import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { z } from "zod";
import { fail } from "../exit";
import { LOCAL_WORKER } from "./routes";
import { serverOf } from "./server-of";

/** How a `splates worker` command reaches the running `splates server`. */
export interface ServerCallOptions {
	/** The `splates server` to ask; empty for the one this agent runs under. */
	dev: string;
	log: Logger;
	fs?: Fs;
	ps: Ps;
	send?: typeof fetch;
}

/**
 * Asks the running `splates server` at `path`, failing with what it said
 * when it cannot be reached or refuses.
 */
export async function callServer(
	path: string,
	opts: ServerCallOptions & { method?: string; body?: unknown },
): Promise<unknown> {
	const server = await serverOf(opts);
	if (server === null) {
		fail(
			"usage",
			"no `splates server` to ask: give its URL with --dev, as in --dev http://localhost:4310",
		);
	}
	const { url, send } = server;
	let response: Response;
	try {
		// The server refuses a request from any other origin than its own.
		response = await send(new URL(path, url).toString(), {
			method: opts.method ?? "GET",
			headers: {
				origin: url,
				...(opts.body === undefined
					? {}
					: { "content-type": "application/json" }),
			},
			...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
		});
	} catch (error) {
		fail(
			"not_found",
			`splates server at ${url} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!response.ok) {
		const said = await response.text();
		const reason = response.status === 404 ? "not_found" : "usage";
		fail(
			reason,
			`splates server at ${url} refused: ${response.status} ${said}`,
		);
	}
	return response.json();
}

const Removed = z.object({
	id: z.string(),
	removed: z.boolean(),
	running: z.array(z.string()),
});

/** `splates worker drain <id>`: takes no new agents on it, or takes them again with `undo`. */
export async function drainWorker(
	opts: ServerCallOptions & { id: string; undo: boolean },
): Promise<void> {
	await callServer(`/api/workers/${encodeURIComponent(opts.id)}`, {
		...opts,
		method: "PUT",
		body: { draining: !opts.undo },
	});
	opts.log.info(
		opts.undo
			? `${opts.id} takes new agents again`
			: `${opts.id} takes no new agents; those on it run to their end, and those asking you something let their slots go until you answer`,
	);
}

/** `splates worker slots <id> <n>`: how many agents it runs at once, from now on. */
export async function setWorkerSlots(
	opts: ServerCallOptions & { id: string; slots: number },
): Promise<void> {
	await callServer(`/api/workers/${encodeURIComponent(opts.id)}`, {
		...opts,
		method: "PUT",
		body: { slots: opts.slots },
	});
	opts.log.info(`${opts.id} runs ${opts.slots} agents at once`);
}

/**
 * `splates worker remove <id>`: revokes its key and forgets it, once the
 * agents on it end, or at once with `force`, ending them. This machine's
 * own only stops taking agents, until `splates worker drain local --undo`.
 */
export async function removeWorker(
	opts: ServerCallOptions & { id: string; force: boolean },
): Promise<void> {
	const { id, removed, running } = Removed.parse(
		await callServer(
			`/api/workers/${encodeURIComponent(opts.id)}${opts.force ? "?force" : ""}`,
			{ ...opts, method: "DELETE" },
		),
	);
	if (id === LOCAL_WORKER) {
		opts.log.info(
			removed
				? "removed this machine's worker: it only coordinates, until `splates worker drain local --undo`"
				: `this machine's worker drains, and is removed once ${running.join(", ")} end`,
		);
		return;
	}
	opts.log.info(
		removed
			? `removed ${id}${running.length > 0 ? `, ending ${running.join(", ")}` : ""}`
			: `${id} drains, and is removed once ${running.join(", ")} end; --force ends them now and carries their tasks on elsewhere`,
	);
}

/** Pauses or resumes automatic starts, as the Queue page's Pause control does. */
export async function setQueuePaused(
	opts: ServerCallOptions & { paused: boolean },
): Promise<void> {
	await callServer(`/api/workers/${LOCAL_WORKER}`, {
		...opts,
		method: "PUT",
		body: { paused: opts.paused },
	});
	opts.log.info(
		opts.paused ? "paused automatic starts" : "resumed automatic starts",
	);
}
