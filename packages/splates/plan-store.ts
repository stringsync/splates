import type { Fs } from "webappwiz/system";
import { PLAN_FILE, Plans } from "./plan";

/**
 * Each task's `SPLATES.md` kept in repo state, `<splatesDir>/plans/<task>.md`,
 * through the command's `fs`: on a worker that is the coordinator's disk, so
 * the plan outlives the checkout it was written in. It is never in a branch,
 * and so never on trunk.
 */
export class PlanStore {
	private readonly plans: Plans;

	constructor(
		private readonly fs: Fs,
		private readonly splatesDir: string,
	) {
		this.plans = new Plans(fs);
	}

	/** Copies the plan in checkout `tree` here; a tree with none changes nothing. */
	async save(task: string, tree: string): Promise<void> {
		const plan = await this.plans.read(tree);
		if (plan === null) {
			return;
		}
		await this.fs.mkdir(this.dir(), { recursive: true });
		await this.fs.write(this.at(task), plan);
	}

	/** Forgets the plan of a task that merged or was removed. */
	async drop(task: string): Promise<void> {
		await this.fs.rm(this.at(task), { force: true });
	}

	/** Writes the kept plan into checkout `tree` when it has none of its own. */
	async restore(task: string, tree: string): Promise<boolean> {
		if ((await this.plans.read(tree)) !== null) {
			return false;
		}
		const kept = await this.fs.read(this.at(task)).catch(() => null);
		if (kept === null) {
			return false;
		}
		await this.fs.write(`${tree}/${PLAN_FILE}`, kept);
		return true;
	}

	private dir(): string {
		return `${this.splatesDir}/plans`;
	}

	private at(task: string): string {
		return `${this.dir()}/${task}.md`;
	}
}
