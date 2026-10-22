import type { Fs } from "webappwiz/system";
import type { Collection, Storage } from "../storage";
import { PLAN_FILE, Plans } from "./plan";

/**
 * Each task's `SPLATES.md` kept in repo state, ``plans/<task>.md``,
 * through the command's `fs`: on a worker that is the server's disk, so
 * the plan outlives the checkout it was written in. It is never in a branch,
 * and so never on trunk.
 */
export class PlanStore {
	private readonly plans: Plans;
	private readonly kept: Collection;

	constructor(
		/** Reads and writes the checkouts' own `SPLATES.md`. */
		private readonly fs: Fs,
		/** The project's, holding `plans/`. */
		storage: Storage,
	) {
		this.plans = new Plans(fs);
		this.kept = storage.collection("plans");
	}

	/** Copies the plan in checkout `tree` here; a tree with none changes nothing. */
	async save(task: string, tree: string): Promise<void> {
		const plan = await this.plans.read(tree);
		if (plan === null) {
			return;
		}
		await this.kept.write(this.at(task), plan);
	}

	/** Forgets the plan of a task that merged or was removed. */
	async drop(task: string): Promise<void> {
		await this.kept.remove(this.at(task));
	}

	/** Writes the kept plan into checkout `tree` when it has none of its own. */
	async restore(task: string, tree: string): Promise<boolean> {
		if ((await this.plans.read(tree)) !== null) {
			return false;
		}
		const kept = await this.kept.read(this.at(task)).catch(() => null);
		if (kept === null) {
			return false;
		}
		await this.fs.write(`${tree}/${PLAN_FILE}`, kept);
		return true;
	}

	private at(task: string): string {
		return `${task}.md`;
	}
}
