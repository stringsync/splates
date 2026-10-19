import { basename } from "node:path";
import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import {
	Duration,
	SystemWallClock,
	timeAgo,
	type WallClock,
} from "webappwiz/time";
import { z } from "zod";
import { fail } from "../exit";
import { table } from "../table";
import type { QueueEntry } from "./scheduler";

/** One agent waiting for a slot, as `GET /api/queue` and `splates worker queue list` give it. */
export interface QueueListing {
	/** Its conversation's id, or `#<n>` for queued task n. */
	id: string;
	/** The main tree of its project. */
	project: string;
	task: string | null;
	position: number;
	/** When it joined the queue. */
	since: string;
	reason: string;
	/** A queued task waiting to start its agent, which `splates queue` orders. */
	queued?: true;
}

/** `entries` as `GET /api/queue` answers them. */
export function queueListing(entries: QueueEntry[]): QueueListing[] {
	return entries.map((entry) => ({
		...entry,
		since: new Date(entry.since).toISOString(),
	}));
}

const Listings = z.object({
	queue: z.array(
		z.object({
			id: z.string(),
			project: z.string(),
			task: z.string().nullable(),
			position: z.number(),
			since: z.string(),
			reason: z.string(),
			queued: z.literal(true).optional(),
		}),
	),
});

/** What `splates worker queue` is run with. */
export interface QueueOptions {
	/** The `splates server` to ask; empty for the one this agent runs under. */
	dev: string;
	json: boolean;
	log: Logger;
	ps: Ps;
	send?: typeof fetch;
	wall?: WallClock;
}

/** `splates worker queue list`: the agents waiting for a slot on the running `splates server`. */
export async function listQueue(opts: QueueOptions): Promise<void> {
	print(await ask("/api/queue", opts), opts);
}

/**
 * `splates worker queue move`: puts the agent waiting for `which`, a task or a
 * conversation's id, at `position` in the queue, from 1.
 */
export async function moveQueued(
	opts: QueueOptions & { which: string; position: number },
): Promise<void> {
	const { queue } = await ask("/api/queue", opts);
	const found = queue.filter(
		(entry) => entry.id === opts.which || entry.task === opts.which,
	);
	const [entry] = found;
	if (entry === undefined) {
		fail("not_found", `nothing waits in the queue for ${opts.which}`, {
			which: opts.which,
		});
	}
	if (found.length > 1) {
		fail(
			"usage",
			`${found.length} conversations of ${opts.which} wait: name one by its id (${found.map((each) => each.id).join(", ")})`,
			{ which: opts.which },
		);
	}
	if (entry.queued === true) {
		fail(
			"usage",
			`${entry.id} is a queued task, waiting to start its agent: order it with \`splates queue move\``,
			{ which: opts.which },
		);
	}
	print(
		await ask(`/api/queue/${encodeURIComponent(entry.id)}/position`, {
			...opts,
			init: {
				method: "PUT",
				body: JSON.stringify({ position: opts.position }),
			},
		}),
		opts,
	);
}

async function ask(
	path: string,
	{ dev, ps, send = fetch, init = {} }: QueueOptions & { init?: RequestInit },
): Promise<z.infer<typeof Listings>> {
	const url = dev || ps.env("SPLATES_DEV");
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
			...init,
			headers: {
				origin: new URL(url).origin,
				"content-type": "application/json",
			},
		});
	} catch (error) {
		fail(
			"not_found",
			`splates server at ${url} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (response.status === 404 && init.method === "PUT") {
		fail(
			"not_found",
			"it is no longer in the queue: it has a slot, or stopped",
		);
	}
	if (!response.ok) {
		fail(
			"not_found",
			`splates server at ${url} did not answer for its queue: ${response.status} ${await response.text()}`,
		);
	}
	return Listings.parse(await response.json());
}

function print(
	{ queue }: z.infer<typeof Listings>,
	{ json, log, wall = new SystemWallClock() }: QueueOptions,
): void {
	if (json) {
		log.info(JSON.stringify(queue, null, "\t"));
		return;
	}
	if (queue.length === 0) {
		log.info("nothing waits for a slot");
		return;
	}
	log.info(
		table(
			["#", "project", "task", "conversation", "waited", "why"],
			queue.map((entry) => [
				String(entry.position),
				basename(entry.project),
				entry.task ?? "-",
				entry.id,
				timeAgo(Duration.ms(Math.max(0, wall.now() - Date.parse(entry.since)))),
				entry.reason,
			]),
		),
	);
}
