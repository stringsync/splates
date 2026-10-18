import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import {
	Duration,
	SystemWallClock,
	timeAgo,
	type WallClock,
} from "webappwiz/time";
import { z } from "zod";
import { table } from "../table";
import { callServer } from "./admin";
import type { WorkerRecord } from "./records";
import type { WorkerRegistry } from "./registry";
import type { RemoteWorker, WorkerKind } from "./remote";
import { slotsOf } from "./slots";

/** One worker as `GET /api/workers` and `splates worker list` give it. */
export interface WorkerListing {
	id: string;
	kind: WorkerKind;
	platform: string | null;
	build: string | null;
	/** What its link settled on; null before any handshake. */
	protocol: string | null;
	slots: { used: number; total: number | null };
	/** `connected` while the link is up, else `away`. */
	health: "connected" | "away";
	/** Takes no new agents, by `splates worker drain` or a removal waiting on its agents. */
	draining: boolean;
	/** Is removed once its last agent ends. */
	removing: boolean;
	/** When anything last came from it, epoch milliseconds; null before the first. */
	lastHeard: number | null;
	/** The tasks its agents run, a conversation's id for one in no task. */
	tasks: string[];
	dollarsPerHour: number;
}

/** What `GET /api/workers` answers. */
export interface WorkerListings {
	workers: WorkerListing[];
	refused: { id: string; protocol: string; reason: string }[];
}

/**
 * The workers a registry keeps and the ones it turned away; `placed`, the
 * tasks each runs, by its id, a conversation's id for one in no task;
 * `record`, what was set on each by hand.
 */
export function workerList(
	registry: WorkerRegistry,
	placed: Map<string, string[]> = new Map(),
	record: (id: string) => WorkerRecord | undefined = () => undefined,
): WorkerListings {
	return {
		workers: registry.workers.map((worker) =>
			listing(worker, placed.get(worker.id) ?? [], record(worker.id)),
		),
		refused: registry.refused,
	};
}

function listing(
	worker: RemoteWorker,
	tasks: string[],
	record: WorkerRecord | undefined,
): WorkerListing {
	const { info, session } = worker;
	const negotiated = session.negotiated;
	return {
		id: worker.id,
		kind: worker.kind,
		platform: typeof info.platform === "string" ? info.platform : null,
		build: typeof info.build === "string" ? info.build : null,
		protocol: negotiated?.ok ? negotiated.protocol : null,
		slots: {
			used: tasks.length,
			total:
				record?.slots != null || typeof info.slots === "number"
					? slotsOf(worker, record)
					: null,
		},
		health: worker.connected ? "connected" : "away",
		draining: record?.draining === true,
		removing: record?.removing === true,
		lastHeard: session.lastHeard,
		tasks,
		dollarsPerHour: record?.provisioned?.dollarsPerHour ?? 0,
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
			draining: z.boolean().default(false),
			removing: z.boolean().default(false),
			lastHeard: z.number().nullable(),
			tasks: z.array(z.string()),
			dollarsPerHour: z.number(),
		}),
	),
	refused: z.array(
		z.object({ id: z.string(), protocol: z.string(), reason: z.string() }),
	),
});

/** What `splates worker list` is run with. */
export interface ListWorkersOptions {
	/** The `splates server` to ask; empty for the one this agent runs under. */
	dev: string;
	json: boolean;
	log: Logger;
	ps: Ps;
	send?: typeof fetch;
	wall?: WallClock;
}

/** `splates worker list`: asks the running `splates server` which workers it has. */
export async function listWorkers(opts: ListWorkersOptions): Promise<void> {
	const { log, wall = new SystemWallClock() } = opts;
	const listed = Listings.parse(await callServer("/api/workers", opts));
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
	const state = worker.removing
		? `${worker.health}, removing`
		: worker.draining
			? `${worker.health}, draining`
			: worker.health;
	if (worker.lastHeard === null) {
		return state;
	}
	const ago = timeAgo(Duration.ms(Math.max(0, wall.now() - worker.lastHeard)));
	return `${state}, heard ${ago}`;
}
