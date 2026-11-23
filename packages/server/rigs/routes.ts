import { z } from "zod";
import type { Document } from "../storage";
import type { RigCommands, RigListing } from "./commands";
import { RunRefused } from "./refused";
import type { RunTree, RunView } from "./run";
import type { RigRuns } from "./runs";
import type { OptionValues } from "./start";

/** Saved presets, by `<group>/<rig>`, then by name. */
export type RigPresets = Record<string, Record<string, OptionValues>>;

/** What `GET /api/rigs` answers: the rigs, the runs, and where runs may start. */
export interface RigsPage extends RigListing {
	runs: RunView[];
	/** Each tree a run may start on, main first. */
	trees: string[];
	presets: RigPresets;
}

/** What {@link RigRoutes} reads rigs, runs, trees and presets from. */
export interface RigRoutesDeps {
	commands: RigCommands;
	runs: RigRuns;
	/** Where a run may start: main and each task's worktree. */
	trees: () => Promise<RunTree[]>;
	/** Where presets are saved. */
	presets: Document<RigPresets>;
}

/**
 * What the Rigs page calls: `GET /api/rigs` lists the rigs, runs, trees and
 * presets; `POST /api/rigs/start` and `/api/rigs/stop` start and stop a run;
 * `GET /api/rigs/log?id=&after=` reads a run's log; `PUT` and `DELETE
 * /api/rigs/presets` save and drop a preset.
 */
export class RigRoutes {
	readonly #deps: RigRoutesDeps;
	#last: RigListing | null = null;
	#reading: Promise<RigListing> | null = null;

	constructor(deps: RigRoutesDeps) {
		this.#deps = deps;
	}

	/** The rigs, as last read unless `fresh`: describing them runs every command. */
	listing(fresh = false): Promise<RigListing> {
		this.#reading ??= this.#deps.commands
			.list()
			.then((listing) => {
				this.#last = listing;
				return listing;
			})
			.finally(() => {
				this.#reading = null;
			});
		if (this.#last !== null && !fresh) {
			this.#reading.catch(() => {});
			return Promise.resolve(this.#last);
		}
		return this.#reading;
	}

	/** `GET /api/rigs`, `?fresh=1` to read the commands again first. */
	readonly rigs = async (request: Request): Promise<Response> => {
		const fresh = new URL(request.url).searchParams.get("fresh") === "1";
		const [listing, trees, presets] = await Promise.all([
			this.listing(fresh),
			this.#deps.trees(),
			this.#deps.presets.read(),
		]);
		const page: RigsPage = {
			...listing,
			runs: this.#deps.runs.list(),
			trees: trees.map((each) => each.name),
			presets: presets ?? {},
		};
		return Response.json(page);
	};

	/** `POST /api/rigs/start` with `{ group, rig, tree, values?, preset? }`. */
	readonly start = async (request: Request): Promise<Response> => {
		const body = START.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return Response.json(
				{ error: "send { group, rig, tree, values?, preset? }" },
				{ status: 400 },
			);
		}
		try {
			return Response.json(await this.#deps.runs.start(body.data));
		} catch (error) {
			if (error instanceof RunRefused) {
				return Response.json(
					{ error: error.message },
					{ status: error.status },
				);
			}
			throw error;
		}
	};

	/** `POST /api/rigs/stop` with `{ id }`: stops a run, or dismisses an exited one. */
	readonly stop = async (request: Request): Promise<Response> => {
		const body = ID.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return Response.json({ error: "send { id }" }, { status: 400 });
		}
		return this.#deps.runs.stop(body.data.id)
			? Response.json({ ok: true })
			: Response.json({ error: `no run ${body.data.id}` }, { status: 404 });
	};

	/** `GET /api/rigs/log?id=<run>&after=<n>`: its lines after line n. */
	readonly log = async (request: Request): Promise<Response> => {
		const params = new URL(request.url).searchParams;
		const log = this.#deps.runs.log(
			params.get("id") ?? "",
			Number(params.get("after") ?? 0) || 0,
		);
		return log === null
			? Response.json({ error: "no such run" }, { status: 404 })
			: Response.json(log);
	};

	/** `PUT /api/rigs/presets` with `{ group, rig, name, values }`; `DELETE` with no `values`. */
	readonly presets = async (request: Request): Promise<Response> => {
		const body = PRESET.safeParse(await request.json().catch(() => null));
		if (
			!body.success ||
			(request.method === "PUT") !== (body.data.values !== undefined)
		) {
			return Response.json(
				{
					error:
						"send { group, rig, name, values } to save, without values to drop",
				},
				{ status: 400 },
			);
		}
		const { group, rig, name, values } = body.data;
		const key = `${group}/${rig}`;
		const saved = await this.#deps.presets.update((current) => {
			const all = { ...(current ?? {}) };
			const named = { ...(all[key] ?? {}) };
			if (values === undefined) {
				delete named[name];
			} else {
				named[name] = values;
			}
			all[key] = named;
			return all;
		});
		return Response.json(saved);
	};
}

const VALUES = z.record(
	z.string(),
	z.union([z.boolean(), z.string(), z.number()]),
);

const START = z.object({
	group: z.string().min(1),
	rig: z.string().min(1),
	tree: z.string().min(1),
	values: VALUES.optional(),
	preset: z.string().min(1).nullable().optional(),
});

const ID = z.object({ id: z.string().min(1) });

const PRESET = z.object({
	group: z.string().min(1),
	rig: z.string().min(1),
	name: z.string().trim().min(1),
	values: VALUES.optional(),
});
