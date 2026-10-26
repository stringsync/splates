import { join, resolve, sep } from "node:path";
import type { Ps } from "webappwiz/system";
import { fail } from "../exit";
import { splatesHome } from "../models";
import type { Handler } from "../server/shared";
import { evalsDonePrompt } from "./done";
import { EvalStore } from "./store";

/**
 * The saved eval batches the Evals page and the report card read, from
 * `evals` in splates's home, as `splates dev eval run` graded them. Only a
 * checkout has the harness; from a release the routes answer 404.
 */
export class EvalRoutes {
	private readonly directory: string;
	private store: EvalStore | null = null;

	constructor(private readonly opts: EvalOptions) {
		this.directory = evalsDirectory(opts.ps);
	}

	/** Whether this server runs from a checkout, which has the harness. */
	get available(): boolean {
		return this.opts.checkout !== null;
	}

	readonly list: Handler = async () =>
		Response.json(await (await this.opened()).batches());

	/** `?id=` names the batch, as `EvalBatch.id` does. */
	readonly batch: Handler = async (request) => {
		const id = new URL(request.url).searchParams.get("id") ?? "";
		const grid = await (await this.opened()).grid(id);
		if (grid === null) {
			fail("not_found", `no eval batch ${id}`, { id });
		}
		return Response.json(grid);
	};

	/** `?id=` names the run, as `EvalRun.id` does. */
	readonly run: Handler = async (request) => {
		const id = new URL(request.url).searchParams.get("id") ?? "";
		const path = resolve(this.directory, id);
		if (
			!path.startsWith(this.directory + sep) ||
			!path.endsWith(`${sep}result.json`)
		) {
			fail("usage", `no eval run ${id}`, { id });
		}
		const store = await this.opened();
		return Response.json(
			await store
				.run(id)
				.catch(() => fail("not_found", `no eval run ${id}`, { id })),
		);
	};

	/**
	 * What tells the agent whose card started batch `id` that it is done, with
	 * its report condensed; null when the batch is not there.
	 */
	async donePrompt(id: string): Promise<string | null> {
		const store = await this.opened();
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

	private async opened(): Promise<EvalStore> {
		if (this.opts.checkout === null) {
			fail("not_found", "evals are read from a splates checkout", {});
		}
		this.store ??= new EvalStore(this.directory);
		return this.store;
	}
}

/** Where `splates dev eval run` writes its batches, in splates's home. */
export function evalsDirectory(ps: Ps): string {
	return join(splatesHome(ps), "evals");
}

interface EvalOptions {
	ps: Ps;
	/** The checkout's root, or null when splates runs from a release. */
	checkout: string | null;
}
