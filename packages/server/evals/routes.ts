import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { Ps } from "webappwiz/system";
import type { EvalsConfig } from "../config";
import { fail } from "../exit";
import { splatesHome } from "../models";
import type { Handler } from "../server/shared";
import { evalsDonePrompt } from "./done";
import { EvalStore } from "./store";

/**
 * The saved eval batches the Evals page and the report card read: from the
 * directory a project's `evals.results` names, which any framework writes in
 * the public format, or, for a project that names none on a server run from
 * a checkout, from `evals` in splates's home, as `splates dev eval run`
 * graded them. With neither, the routes answer 404.
 */
export class EvalRoutes {
	private readonly stores = new Map<string, EvalStore>();

	constructor(private readonly opts: EvalOptions) {}

	readonly list: Handler = async (request) =>
		Response.json(await (await this.opened(request)).store.batches());

	/** `?id=` names the batch, as `EvalBatch.id` does. */
	readonly batch: Handler = async (request) => {
		const id = new URL(request.url).searchParams.get("id") ?? "";
		const grid = await (await this.opened(request)).store.grid(id);
		if (grid === null) {
			fail("not_found", `no eval batch ${id}`, { id });
		}
		return Response.json(grid);
	};

	/** `?id=` names the run, as `EvalRun.id` does. */
	readonly run: Handler = async (request) => {
		const id = new URL(request.url).searchParams.get("id") ?? "";
		const { directory, store } = await this.opened(request);
		const hash = id.lastIndexOf("#");
		const path = resolve(directory, hash === -1 ? id : id.slice(0, hash));
		if (
			!path.startsWith(directory + sep) ||
			(hash === -1 && !path.endsWith(`${sep}result.json`))
		) {
			fail("usage", `no eval run ${id}`, { id });
		}
		return Response.json(
			await store
				.run(id)
				.catch(() => fail("not_found", `no eval run ${id}`, { id })),
		);
	};

	/**
	 * What tells the agent whose card started batch `id`, in `directory`, that
	 * it is done, with its report condensed; null when the batch is not there.
	 */
	async donePrompt(directory: string, id: string): Promise<string | null> {
		const store = this.storeOf(directory);
		const grid = await store.grid(id);
		if (grid === null) {
			return null;
		}
		const missed = grid.grid.flatMap((cell) =>
			cell.run === null || cell.run.status === "pass" ? [] : [cell.run.id],
		);
		const details = await Promise.all(
			missed.map((run) => store.run(run).catch(() => null)),
		);
		return evalsDonePrompt(
			grid,
			details.filter((each) => each !== null),
		);
	}

	private async opened(
		request: Request,
	): Promise<{ directory: string; store: EvalStore }> {
		const directory = await this.opts.directory(request);
		if (directory === null) {
			fail(
				"not_found",
				"this project names no evals.results in splates.config.ts",
				{},
			);
		}
		return { directory, store: this.storeOf(directory) };
	}

	private storeOf(directory: string): EvalStore {
		let store = this.stores.get(directory);
		if (store === undefined) {
			store = new EvalStore(directory);
			this.stores.set(directory, store);
		}
		return store;
	}
}

/**
 * Where a project's evals report: its `evals.results`, against `root` unless
 * absolute or under `~`, or null for a project that names none.
 */
export function projectEvalsDirectory(
	ps: Ps,
	root: string,
	evals: EvalsConfig | null,
): string | null {
	if (evals === null) {
		return null;
	}
	const { results } = evals;
	if (results === "~" || results.startsWith("~/")) {
		return resolve(ps.env("HOME") ?? homedir(), results.slice(2));
	}
	return resolve(root, results);
}

/** Where `splates dev eval run` writes its batches, in splates's home. */
export function evalsDirectory(ps: Ps): string {
	return join(splatesHome(ps), "evals");
}

interface EvalOptions {
	/** The directory the project `request` names reads its batches from, or null for none. */
	directory: (request: Request) => Promise<string | null>;
}
