import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import {
	Duration,
	SystemWallClock,
	timeAgo,
	type WallClock,
} from "webappwiz/time";
import { z } from "zod";
import { fail } from "./exit";
import type { RemoteWorker, WorkerKind } from "./remote-worker";
import { table } from "./table";
import type { WorkerRegistry } from "./worker-registry";

/** One worker as `GET /api/workers` and `arbor worker list` give it. */
export interface WorkerListing {
	id: string;
	/** `provisioned` is for workers arbor makes itself, which do not exist yet. */
	kind: WorkerKind | "provisioned";
	platform: string | null;
	build: string | null;
	/** What its link settled on; null before any handshake. */
	protocol: string | null;
	slots: { used: number; total: number | null };
	/** `connected` while the link is up, else `away`. */
	health: "connected" | "away";
	/** When anything last came from it, epoch milliseconds; null before the first. */
	lastHeard: number | null;
	/** The tasks placed on it; none until tasks are placed on workers. */
	tasks: string[];
	dollarsPerHour: number;
}

/** What `GET /api/workers` answers. */
export interface WorkerListings {
	workers: WorkerListing[];
	refused: { id: string; protocol: string; reason: string }[];
}

/** The workers a registry keeps and the ones it turned away. */
export function workerList(registry: WorkerRegistry): WorkerListings {
	return {
		workers: registry.workers.map(listing),
		refused: registry.refused,
	};
}

function listing(worker: RemoteWorker): WorkerListing {
	const { info, session } = worker;
	const negotiated = session.negotiated;
	return {
		id: worker.id,
		kind: worker.kind,
		platform: typeof info.platform === "string" ? info.platform : null,
		build: typeof info.build === "string" ? info.build : null,
		protocol: negotiated?.ok ? negotiated.protocol : null,
		slots: {
			used: 0,
			total: typeof info.slots === "number" ? info.slots : null,
		},
		health: worker.connected ? "connected" : "away",
		lastHeard: session.lastHeard,
		tasks: [],
		dollarsPerHour: 0,
	};
}

const Listings = z.object({
	workers: z.array(
		z.object({
			id: z.string(),
			kind: z.enum(["local", "registered", "provisioned"]),
			platform: z.string().nullable(),
			build: z.string().nullable(),
			protocol: z.string().nullable(),
			slots: z.object({ used: z.number(), total: z.number().nullable() }),
			health: z.enum(["connected", "away"]),
			lastHeard: z.number().nullable(),
			tasks: z.array(z.string()),
			dollarsPerHour: z.number(),
		}),
	),
	refused: z.array(
		z.object({ id: z.string(), protocol: z.string(), reason: z.string() }),
	),
});

/** What `arbor worker list` is run with. */
export interface ListWorkersOptions {
	/** The `arbor dev` to ask; empty for the one this agent runs under. */
	dev: string;
	json: boolean;
	log: Logger;
	ps: Ps;
	send?: typeof fetch;
	wall?: WallClock;
}

/** `arbor worker list`: asks the running `arbor dev` which workers it has. */
export async function listWorkers(opts: ListWorkersOptions): Promise<void> {
	const { log, ps, send = fetch, wall = new SystemWallClock() } = opts;
	const url = opts.dev || ps.env("ARBOR_DEV");
	if (!url) {
		fail(
			"usage",
			"no `arbor dev` to ask: give its URL with --dev, as in --dev http://localhost:4310",
		);
	}
	let response: Response;
	try {
		// The server refuses a request from any other origin than its own.
		response = await send(new URL("/api/workers", url), {
			headers: { origin: new URL(url).origin },
		});
	} catch (error) {
		fail(
			"not_found",
			`arbor dev at ${url} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!response.ok) {
		fail(
			"not_found",
			`arbor dev at ${url} did not list its workers: ${response.status} ${await response.text()}`,
		);
	}
	const listed = Listings.parse(await response.json());
	if (opts.json) {
		log.info(JSON.stringify(listed, null, "\t"));
		return;
	}
	const lines: string[] = [];
	if (listed.workers.length > 0) {
		lines.push(
			table(
				[
					"worker",
					"kind",
					"platform",
					"build",
					"protocol",
					"slots",
					"health",
					"tasks",
					"$/hour",
				],
				listed.workers.map((worker) => [
					worker.id,
					worker.kind,
					worker.platform ?? "?",
					worker.build ?? "?",
					worker.protocol ?? "?",
					`${worker.slots.used}/${worker.slots.total ?? "?"}`,
					health(worker, wall),
					worker.tasks.join(",") || "-",
					worker.dollarsPerHour.toFixed(2),
				]),
			),
		);
	}
	for (const refused of listed.refused) {
		lines.push(
			`refused ${refused.id} (${refused.protocol}): ${refused.reason}`,
		);
	}
	log.info(lines.join("\n"));
}

function health(
	worker: WorkerListings["workers"][number],
	wall: WallClock,
): string {
	if (worker.lastHeard === null) {
		return worker.health;
	}
	const ago = timeAgo(Duration.ms(Math.max(0, wall.now() - worker.lastHeard)));
	return `${worker.health}, heard ${ago}`;
}
