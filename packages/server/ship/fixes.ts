import type { Logger } from "core/log";
import type { ShipEngine } from "./engine";
import { RunError } from "./run-error";
import type { RunState, StepState, TargetState } from "./run-state";

/** How many of a failed step's last output lines its fix task quotes. */
const QUOTED_LINES = 40;

/** Where a ship's fixes go: the board, and the agents that take its tasks. */
export interface FixDesk {
	/** Adds a board task, answering its number. */
	add(subject: string, text: string): Promise<number>;
	/** Starts an agent's conversation on board task `task`. */
	start(task: number): Promise<void>;
	/** How board task `task` ended, or null while it is still on the board. */
	ended(task: number): Promise<"merged" | "removed" | null>;
	/** The started task that took board task `task`, or null for none. */
	takenBy(task: number): Promise<string | null>;
}

/**
 * Sends a ship's failed step to an agent as a board task, and sends the step
 * round again once that task ends: call `settle` whenever a task may have
 * ended, and once as the server starts.
 */
export class ShipFixes {
	#settling: Promise<void> = Promise.resolve();
	/** A settle waiting its turn, which a call meanwhile shares. */
	#queued: Promise<void> | null = null;

	constructor(
		private readonly engine: ShipEngine,
		private readonly desk: FixDesk,
		private readonly log: Logger,
	) {}

	/** Adds the fix task for failed step `step` and starts its agent. */
	async send(
		id: string,
		target: string,
		step: string,
	): Promise<{ state: RunState; task: number }> {
		const state = await this.engine.get(id);
		if (state === null) {
			throw new RunError(`No ship run is "${id}"`, 404);
		}
		const found = failedStep(state, target, step);
		const open = found.step.fix;
		if (open !== undefined && open.ended === undefined) {
			throw new RunError(
				`"${step}" of ${target} is already with an agent, as task #${open.task}`,
			);
		}
		const task = await this.desk.add(
			`The ship step ${step} of ${target} passes, and the ship carries on`,
			fixText(state, found.target, found.step),
		);
		const sent = await this.engine.sent(id, target, step, task);
		await this.desk
			.start(task)
			.catch((error: unknown) =>
				this.log.error(
					`The fix task #${task} for "${step}" of ${target} did not start: ${String(error)}`,
				),
			);
		return { state: sent, task };
	}

	/**
	 * Notes every fix that ended since: either ending, a merge or a
	 * removal, retries its step.
	 */
	settle(): Promise<void> {
		if (this.#queued !== null) {
			return this.#queued;
		}
		const next = this.#settling
			.then(() => {
				this.#queued = null;
				return this.#settle();
			})
			.catch((error: unknown) =>
				this.log.error(`The ship's fixes could not settle: ${String(error)}`),
			);
		this.#queued = next;
		this.#settling = next;
		return next;
	}

	async #settle(): Promise<void> {
		for (const run of await this.engine.list()) {
			for (const target of run.targets) {
				for (const step of target.steps) {
					const fix = step.fix;
					if (fix === undefined || fix.ended !== undefined) {
						continue;
					}
					const ended = await this.desk.ended(fix.task);
					if (ended !== null) {
						await this.engine.fixed(
							run.id,
							target.name,
							step.id,
							fix.task,
							ended,
						);
					}
				}
			}
		}
	}

	/**
	 * Sends failed step `step` round again for the started task `task`: any
	 * agent may carry on a ship the user started, as it never starts one.
	 */
	async retry(
		id: string,
		target: string,
		step: string,
		task: string,
	): Promise<RunState> {
		const state = await this.engine.get(id);
		if (state === null) {
			throw new RunError(`No ship run is "${id}"`, 404);
		}
		failedStep(state, target, step);
		return this.engine.retry(id, target, step, "agent", task);
	}
}

function failedStep(
	state: RunState,
	target: string,
	step: string,
): { target: TargetState; step: StepState } {
	const found = state.targets.find((each) => each.name === target);
	const at = found?.steps.find((each) => each.id === step);
	if (found === undefined || at === undefined) {
		throw new RunError(`The run has no step "${step}" of ${target}`, 404);
	}
	if (at.status !== "failed") {
		throw new RunError(`"${step}" of ${target} has not failed`);
	}
	return { target: found, step: at };
}

/** The fix task's words: the step, its target's plan, its error and output. */
export function fixText(
	state: RunState,
	target: TargetState,
	step: StepState,
): string {
	const plan = target.steps.map((each, index) => {
		const after =
			each.dependencies.length === 0
				? ""
				: ` (after ${each.dependencies.join(", ")})`;
		const failed = each.id === step.id ? " ← failed" : "";
		return `${index + 1}. \`${each.id}\`: ${each.does}${after}${failed}`;
	});
	const output = step.output.slice(-QUOTED_LINES).join("\n").trimEnd();
	const show = `splates ships show ${state.id} --target ${target.name} --step ${step.id}`;
	const retry = `splates ships retry ${state.id} --target ${target.name} --step ${step.id}`;
	return [
		"## Before",
		"",
		`The ship run ${state.id} stopped: step \`${step.id}\` of ${target.name} (${step.does}) failed.`,
		"",
		"## After",
		"",
		`The step passes once this fix merges: the ship retries it by itself and carries on.`,
		"",
		"## Details",
		"",
		"This task belongs to a ship the user started. Fix what made the step fail and land it with `splates merge`; the ship retries the step once it merges, with no press from the user. Never start a ship or bump a version further.",
		"",
		`- Read the run, and the step's whole output: \`${show}\``,
		`- Try the step again before merging (it runs from the main tree): \`${retry}\``,
		"",
		"### Error",
		"",
		"```",
		step.error ?? "(no error was given)",
		"```",
		"",
		`### Plan of ${target.name}${target.bump === undefined ? "" : ` (${target.bump})`}`,
		"",
		...(target.dependencies.length === 0
			? []
			: [`Ships after ${target.dependencies.join(", ")}.`, ""]),
		...plan,
		"",
		`### Last output of \`${step.id}\``,
		"",
		"```",
		output === "" ? "(none)" : output,
		"```",
	].join("\n");
}
