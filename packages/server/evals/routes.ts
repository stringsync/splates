import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import type { Ps } from "webappwiz/system";
import type { EvalsConfig } from "../config";
import { fail } from "../exit";
import type { Handler } from "../server/shared";
import { evalsDonePrompt } from "./done";
import type { EvalCommands } from "./launch";
import { EvalStore } from "./store";

/**
 * The saved eval batches the Evals page and the report card read, from the
 * directory a project's `evals.results` names, which any framework writes in
 * the public format. For a project that names none, the list answers null and
 * the other routes 404.
 */
export class EvalRoutes {
	private readonly stores = new Map<string, EvalStore>();

	constructor(private readonly opts: EvalOptions) {}

	/** The batches, or null when the project names no results. */
	readonly list: Handler = async (request) => {
		const directory = await this.opts.directory(request);
		return Response.json(
			directory === null ? null : await this.storeOf(directory).batches(),
		);
	};

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
		if (
			hash === -1 ||
			!resolve(directory, id.slice(0, hash)).startsWith(directory + sep)
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
 * A project's eval commands from its `evals` block, `results` resolved
 * against `root` unless absolute or under `~`; null for a project that
 * names none.
 */
export function projectEvalCommands(
	ps: Ps,
	root: string,
	evals: EvalsConfig | null,
): EvalCommands | null {
	if (evals === null) {
		return null;
	}
	const { results } = evals;
	return {
		root,
		results:
			results === "~" || results.startsWith("~/")
				? resolve(ps.env("HOME") ?? homedir(), results.slice(2))
				: resolve(root, results),
		list: evals.list ?? null,
		run: evals.run ?? null,
		plan: evals.plan ?? null,
	};
}

interface EvalOptions {
	/** The directory the project `request` names reads its batches from, or null for none. */
	directory: (request: Request) => Promise<string | null>;
}
