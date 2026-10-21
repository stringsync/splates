import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import {
	Duration,
	SystemWallClock,
	timeAgo,
	type WallClock,
} from "webappwiz/time";
import { z } from "zod";
import { table } from "../table";
import { callServer, type ServerCallOptions } from "./admin";
import type { KeyedWorker, WorkerKey } from "./keys";
import type { WorkerRecord } from "./records";
import type { WorkerRegistry } from "./registry";
import type { RemoteWorker, WorkerKind } from "./remote";
import type { RolloutStanding } from "./rollout";
import { sleeps, slotsOf } from "./slots";

/** One worker as `GET /api/workers` and `splates worker list` give it. */
export interface WorkerListing {
	id: string;
	kind: WorkerKind;
	platform: string | null;
	/** What the platform runs inside, such as `wsl2`; null on the bare machine. */
	host: string | null;
	build: string | null;
	/** What its link settled on; null before any handshake. */
	protocol: string | null;
	slots: { used: number; total: number | null };
	/**
	 * `connected` while the link is up; `asleep` for one at home that sleeps
	 * and can be woken, `waking` once it is, until it joins; else `away`.
	 */
	health: "connected" | "away" | "asleep" | "waking";
	/** Takes no new agents, by `splates worker drain` or a removal waiting on its agents. */
	draining: boolean;
	/** Is removed once its last agent ends. */
	removing: boolean;
	/**
	 * Whether the worker checked this coordinator's signing key before it
	 * sent its own key; false for one that joined before join tokens carried
	 * it, until it joins again; null while it is away.
	 */
	verified: boolean | null;
	/** Drains to be brought to the coordinator's build, a rollout's one at a time. */
	updating: boolean;
	/** When anything last came from it, epoch milliseconds; null before the first. */
	lastHeard: number | null;
	/** When it last joined after it was woken over the network, epoch milliseconds; null before. */
	wokenAt: number | null;
	/** The tasks its agents run, a conversation's id for one in no task. */
	tasks: string[];
	dollarsPerHour: number;
	/** The providers whose API key it holds, of its own or its type's, by id. */
	keys: string[];
}

/**
 * The workers a registry keeps and the ones it turned away; `placed`, the
 * tasks each runs, by its id, a conversation's id for one in no task;
 * `record`, what was set on each by hand; `pooled`, whether each takes
 * agents at all, leaving out this machine's own once it is removed.
 */
export function workerList(
	registry: WorkerRegistry,
	placed: Map<string, string[]> = new Map(),
	record: (id: string) => WorkerRecord | undefined = () => undefined,
	pooled: (id: string) => boolean = () => true,
	keys: (worker: KeyedWorker) => WorkerKey[] = () => [],
	waking: (id: string) => boolean = () => false,
): WorkerListings {
	return {
		workers: registry.workers
			.filter((worker) => pooled(worker.id))
			.map((worker) => {
				const kept = record(worker.id);
				const held = keys({
					id: worker.id,
					type: kept?.provisioned?.type ?? null,
				});
				return {
					...listing(worker, placed.get(worker.id) ?? [], kept, waking),
					keys: held.map((each) => each.provider),
				};
			}),
		refused: registry.refused,
	};
}

/** What a registry keeps and turned away, as `workerList` gives them. */
export interface WorkerListings {
	workers: WorkerListing[];
	refused: { id: string; protocol: string; reason: string }[];
}

/**
 * What `GET /api/workers` answers: the listings, the build the coordinator
 * runs, which a worker on another waits to be updated to, and where the
 * rollout bringing them to it stands.
 */
export interface WorkerPool extends WorkerListings {
	build: string;
	rollout: RolloutStanding;
}

function listing(
	worker: RemoteWorker,
	tasks: string[],
	record: WorkerRecord | undefined,
	waking: (id: string) => boolean,
): Omit<WorkerListing, "keys"> {
	const { info, session } = worker;
	const negotiated = session.negotiated;
	return {
		id: worker.id,
		kind: worker.kind,
		platform:
			typeof info.platform === "string"
				? info.platform
				: (record?.wake?.platform ?? null),
		host: typeof info.host === "string" ? info.host : null,
		build: typeof info.build === "string" ? info.build : null,
		protocol: negotiated?.ok ? negotiated.protocol : null,
		slots: {
			used: tasks.length,
			total:
				record?.slots != null ||
				typeof info.slots === "number" ||
				record?.wake?.slots != null
					? slotsOf(worker, record)
					: null,
		},
		health: worker.connected
			? "connected"
			: waking(worker.id)
				? "waking"
				: sleeps(worker, record)
					? "asleep"
					: "away",
		draining: record?.draining === true,
		removing: record?.removing === true,
		updating: record?.updating === true,
		verified: worker.connected ? worker.verified : null,
		lastHeard: session.lastHeard,
		wokenAt: record?.wokenAt ?? null,
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
			host: z.string().nullable().default(null),
			build: z.string().nullable(),
			protocol: z.string().nullable(),
			slots: z.object({ used: z.number(), total: z.number().nullable() }),
			health: z.enum(["connected", "away", "asleep", "waking"]),
			draining: z.boolean().default(false),
			removing: z.boolean().default(false),
			updating: z.boolean().default(false),
			verified: z.boolean().nullable().default(null),
			lastHeard: z.number().nullable(),
			wokenAt: z.number().nullable().default(null),
			tasks: z.array(z.string()),
			dollarsPerHour: z.number(),
			keys: z.array(z.string()).default([]),
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
	fs?: Fs;
	ps: Ps;
	send?: typeof fetch;
	wall?: WallClock;
}

/** The workers the running `splates server` lists. */
export async function fetchWorkers(
	opts: ServerCallOptions,
): Promise<WorkerListing[]> {
	return Listings.parse(await callServer("/api/workers", opts)).workers;
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
					"keys",
					"$/hour",
				],
				listed.workers.map((worker) => [
					worker.id,
					worker.kind,
					platformLabel(worker),
					worker.build ?? "?",
					worker.protocol ?? "?",
					`${worker.slots.used}/${worker.slots.total ?? "?"}`,
					health(worker, wall),
					worker.tasks.join(",") || "-",
					worker.keys.join(",") || "-",
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
		: worker.updating
			? `${worker.health}, updating`
			: worker.draining
				? `${worker.health}, draining`
				: worker.health;
	const shown =
		worker.verified === false
			? `${state}, unverified: join it again to check the coordinator`
			: state;
	if (worker.lastHeard === null) {
		return shown;
	}
	const ago = timeAgo(Duration.ms(Math.max(0, wall.now() - worker.lastHeard)));
	return `${shown}, heard ${ago}`;
}

/** Its platform as the list shows it, with what it runs inside: `linux (wsl2)`. */
export function platformLabel(
	worker: Pick<WorkerListing, "platform" | "host">,
): string {
	const platform = worker.platform ?? "?";
	return worker.host === null ? platform : `${platform} (${worker.host})`;
}
