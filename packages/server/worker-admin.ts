import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { z } from "zod";
import { LOCAL_WORKER } from "./dev-workers";
import { fail } from "./exit";

/** How a `splates worker` command reaches the running `splates server`. */
export interface ServerCallOptions {
	/** The `splates server` to ask; empty for the one this agent runs under. */
	dev: string;
	log: Logger;
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
	const { ps, send = fetch } = opts;
	const url = opts.dev || ps.env("SPLATES_DEV");
	if (!url) {
		fail(
			"usage",
			"no `splates server` to ask: give its URL with --dev, as in --dev http://localhost:4310",
		);
	}
	let response: Response;
	try {
		// The server refuses a request from any other origin than its own.
		response = await send(new URL(path, url), {
			method: opts.method ?? "GET",
			headers: {
				origin: new URL(url).origin,
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

const Invited = z.object({ token: z.string(), expiresAt: z.number() });

const Removed = z.object({
	id: z.string(),
	removed: z.boolean(),
	running: z.array(z.string()),
});

/** What `splates worker add` is run with. */
export interface AddWorkerOptions extends ServerCallOptions {
	/** Slots to make this machine's own worker run, or 0 to mint a join token for another. */
	local: number;
}

/**
 * `splates worker add`: a join token another machine joins with, printed
 * with the command to run there; with `--local N`, this machine's own
 * worker runs N agents at once and takes new ones again.
 */
export async function addWorker(opts: AddWorkerOptions): Promise<void> {
	const { log } = opts;
	if (opts.local > 0) {
		await callServer(`/api/workers/${LOCAL_WORKER}`, {
			...opts,
			method: "PUT",
			body: { slots: opts.local, draining: false },
		});
		log.info(`this machine's worker runs ${opts.local} agents at once`);
		return;
	}
	const { token, expiresAt } = Invited.parse(
		await callServer("/api/workers/invite", { ...opts, method: "POST" }),
	);
	log.info(
		[
			`join token, single use, good until ${new Date(expiresAt).toLocaleTimeString()}:`,
			"",
			`  splates worker run --coordinator <this server's URL> --join ${token}`,
			"",
			"Run it on the machine to join, which keeps the key it is given in its system store.",
		].join("\n"),
	);
}

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
			: `${opts.id} takes no new agents; those on it run to their end`,
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
 * agents on it end, or at once with `force`, ending them.
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
	opts.log.info(
		removed
			? `removed ${id}${running.length > 0 ? `, ending ${running.join(", ")}` : ""}`
			: `${id} drains, and is removed once ${running.join(", ")} end; --force ends them now`,
	);
}
