import type { Storage } from "../storage";
import type { SavedLaunch } from "./launch";
import { LoopRuns } from "./loop-run";
import { EvalLoopStore, loopNext, type StoredEvalLoop } from "./loops";
import { EvalStore } from "./store";

/** Recover a loop’s current instructions and history without starting paid work. */
export class LoopRecovery {
	constructor(
		private readonly storage: Storage,
		private readonly machine: Storage,
		private readonly root: string,
	) {}

	async show(id: string) {
		const saved = await new EvalLoopStore(this.storage).show(id);
		const launches = Object.values(
			(await this.machine
				.document<Record<string, SavedLaunch>>("eval-launches.json")
				.read()) ?? {},
		).filter(
			(each) => each.commands.root === this.root && each.spec.loop?.id === id,
		);
		const candidates = launches.filter(
			(each) =>
				each.spec.loop?.version === saved.version ||
				(saved.history.at(-1)?.id === `run-${each.launch.batch}` &&
					each.spec.loop?.version === saved.version - 1),
		);
		const pending =
			candidates.find((each) => each.launch.status !== "refused") ??
			candidates.at(-1);
		let next = loopNext(saved);
		if (
			pending !== undefined &&
			!saved.loop.batches.some((each) => each.batch.id === pending.launch.batch)
		) {
			const { launch } = pending;
			next =
				launch.status === "refused"
					? "The run was refused. Leave the loop awaiting the person; do not retry automatically."
					: launch.batch !== null
						? `Inspect existing batch ${launch.batch} in ${pending.commands.results}. If every repetition finished, run splates evals reconcile ${id} to record its evidence once, then show again; otherwise wait or reconcile the interrupted run. Do not launch a replacement.`
						: `Reattach to run request ${launch.id} (${launch.status}). No batch is linked yet; inspect the original launch before any further action. Do not launch a replacement.`;
		}
		const card = `## 🧪 Eval loop ${id} at ${saved.version}`;
		const directive = [
			`[SPLATES EVAL LOOP RESUME ${id} at ${saved.version}]`,
			`State: ${saved.loop.stage.kind}`,
			`Conversation: ${saved.conversation}; code task: ${saved.task ?? "none"}`,
			`Run request: ${pending?.launch.id ?? "none"}; batch: ${pending?.launch.batch ?? ("batch" in saved.loop.stage ? saved.loop.stage.batch.id : "none")}`,
			`Next permitted action: ${next}`,
			`Read splates evals resume ${id} for full experiment and round history. This snapshot may be stale: reread before changing state. Restore this current card with the run status above:`,
			card,
			"Resume starts no paid run. Do not repeat a recorded diagnosis or decision. Task resume is separate; claim the linked code task only when code work is next.",
		].join("\n\n");
		return { ...saved, launches, next, card, directive };
	}

	/** Recover missing completion evidence from existing batches without running evals. */
	async reconcile(id: string): Promise<void> {
		const saved = await this.show(id);
		for (const request of saved.launches) {
			if (request.launch.batch === null || request.spec.loop === undefined) {
				continue;
			}
			const grid = await new EvalStore(request.commands.results).grid(
				request.launch.batch,
			);
			if (grid === null) {
				continue;
			}
			await new LoopRuns(new EvalLoopStore(this.storage)).record(
				request.spec.loop,
				grid,
			);
		}
	}

	async conversation(id: string): Promise<string> {
		const records = await Promise.all(
			(await this.storage.keys("eval-loops"))
				.filter((key) => key.endsWith(".json"))
				.map((key) => this.storage.document<StoredEvalLoop>(key).read()),
		);
		const loops = records.filter(
			(saved): saved is StoredEvalLoop =>
				saved != null && saved.conversation === id,
		);
		return (
			await Promise.all(
				loops.map(async (saved) => (await this.show(saved.id)).directive),
			)
		).join("\n\n");
	}
}
