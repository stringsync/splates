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
	/** The commit board task `task` landed as, or null when it did not merge or is unknown. */
	landed?(task: number): Promise<string | null>;
	/** The started task that took board task `task`, or null for none. */
	takenBy(task: number): Promise<string | null>;
}

/**
 * Sends a ship's failed step to an agent as a board task, and sends the step
 * round again once that task merges. In a supervised run it sends each failed
 * step by itself, while the run's budget of fixes lasts and the step's last
 * fix was not given up on. Call `settle` whenever a task may have ended or a
 * run changed, and once as the server starts.
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

	/**
	 * Adds the fix task for failed step `step` and starts its agent: the
	 * user's Send to agent, or the supervisor's, spending one of its fixes.
	 */
	async send(
		id: string,
		target: string,
		step: string,
		by?: "supervisor",
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
			fixText(state, found.target, found.step, by),
		);
		const sent = await this.engine.sent(id, target, step, task, by);
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
	 * Records that the agent of fix task `task` ended without taking it, and
	 * what it last said: its step goes round once, then waits for the user.
	 */
	async abandoned(task: number, note: string | undefined): Promise<void> {
		for (const run of await this.engine.list()) {
			for (const target of run.targets) {
				for (const step of target.steps) {
					if (step.fix?.task === task && step.fix.ended === undefined) {
						await this.engine.fixed(
							run.id,
							target.name,
							step.id,
							task,
							"abandoned",
							undefined,
							note,
						);
					}
				}
			}
		}
		await this.settle();
	}

	/**
	 * Adds one board task for `target`'s recap, its flagged steps (those with
	 * trouble, and `slow` ones against their usual time in milliseconds), and
	 * starts its agent: the user's Send to agent on the recap.
	 */
	async sendTarget(
		id: string,
		target: string,
		slow: Record<string, number>,
	): Promise<{ state: RunState; task: number }> {
		const state = await this.engine.get(id);
		if (state === null) {
			throw new RunError(`No ship run is "${id}"`, 404);
		}
		const found = state.targets.find((each) => each.name === target);
		if (found === undefined) {
			throw new RunError(`The run has no target ${target}`, 404);
		}
		if (found.recap !== undefined) {
			throw new RunError(
				`The recap of ${target} is already with an agent, as task #${found.recap.task}`,
			);
		}
		const text = recapText(state, found, slow);
		if (text === null) {
			throw new RunError(`${target} has nothing flagged to send`);
		}
		const task = await this.desk.add(
			`Look into what went wrong or slow shipping ${target}`,
			text,
		);
		const sent = await this.engine.recapped(id, target, task);
		await this.desk
			.start(task)
			.catch((error: unknown) =>
				this.log.error(
					`The recap task #${task} for ${target} did not start: ${String(error)}`,
				),
			);
		return { state: sent, task };
	}

	/**
	 * Notes every fix that ended since, a merge retrying its step, then sends
	 * each supervised run's failed steps to agents while its budget lasts.
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

	/**
	 * Settles when run `state` has a failed step its supervisor would send,
	 * so a step failing, or the user giving more fixes, sends it at once.
	 */
	changed(state: RunState): void {
		if (unsupervised(state) !== undefined) {
			void this.settle();
		}
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
							ended === "merged"
								? ((await this.desk.landed?.(fix.task)) ?? undefined)
								: undefined,
						);
					}
				}
			}
		}
		for (const run of await this.engine.list()) {
			await this.#supervise(run.id);
		}
	}

	/** Sends run `id`'s failed steps to agents, one fix at a time while its budget lasts. */
	async #supervise(id: string): Promise<void> {
		for (;;) {
			const run = await this.engine.get(id);
			const next = run === null ? undefined : unsupervised(run);
			if (next === undefined) {
				return;
			}
			try {
				await this.send(id, next.target, next.step, "supervisor");
			} catch (error) {
				this.log.error(
					`The ship run ${id} could not send "${next.step}" of ${next.target} to an agent: ${String(error)}`,
				);
				return;
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

/**
 * The next failed step of `run` its supervisor sends to an agent: none once
 * the run is not under way or unsupervised, its budget is spent, or every
 * failed step is with an agent or was given up on.
 */
function unsupervised(
	run: RunState,
): { target: string; step: string } | undefined {
	const supervise = run.supervise;
	if (
		supervise === undefined ||
		supervise.spent >= supervise.budget ||
		(run.status !== "running" && run.status !== "failed")
	) {
		return undefined;
	}
	const isOpen = (step: StepState) =>
		step.fix !== undefined && step.fix.ended === undefined;
	// One fix at a time: steps that failed together usually share a cause,
	// so the next is sent only once the open fix has ended.
	if (run.targets.some((target) => target.steps.some(isOpen))) {
		return undefined;
	}
	for (const target of run.targets) {
		for (const step of target.steps) {
			if (step.status === "failed" && step.handedBack !== true) {
				return { target: target.name, step: step.id };
			}
		}
	}
	return undefined;
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
	by?: "supervisor",
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
	// Written before this fix is sent, so the step's last fix is an earlier one.
	const before = [...(step.earlier ?? []), ...(step.fix ? [step.fix] : [])];
	const earlier = before.map(
		(each) =>
			`- #${each.task}: ${each.ended === "merged" ? "merged, and the step failed again" : each.ended === "removed" ? "removed without merging" : "still open"}`,
	);
	const notes = state.notes
		.filter((each) => each.target === target.name && each.step === step.id)
		.map(
			(each) =>
				`- ${each.text}${each.link === undefined ? "" : ` (${each.link})`}`,
		);
	const supervise = state.supervise;
	const supervised =
		by !== "supervisor" || supervise === undefined
			? []
			: [
					`The ship is supervised, and sent this step here by itself: fix ${supervise.spent + 1} of ${supervise.budget}.`,
					"",
				];
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
		"This task belongs to a ship the user started. Fix what made the step fail and land it with `splates merge`; the ship takes the commit it lands as into the run's own checkout, which stays on the commit the ship started on, and retries the step once it merges, with no press from the user. When code cannot fix it (a missing token, a sign-in only the user can do), remove the task with `--reason blocked` saying why: the step then waits for the user. Never start a ship or bump a version further.",
		"",
		...supervised,
		`- Read the run, and the step's whole output: \`${show}\``,
		`- Try the step again before merging (it runs in the run's checkout, without your unmerged fix): \`${retry}\``,
		"",
		...(earlier.length === 0
			? []
			: [
					"### Earlier fixes of this step",
					"",
					"Read what each tried before trying again.",
					"",
					...earlier,
					"",
				]),
		...(notes.length === 0 ? [] : ["### Notes on this step", "", ...notes, ""]),
		"### Error",
		"",
		"```",
		step.error ?? "(no error was given)",
		"```",
		"",
		`### Plan of ${target.name}${(target.version ?? target.bump) === undefined ? "" : ` (${target.version ?? target.bump})`}`,
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

/** How long `step` took, when it ran. */
function took(step: StepState): number | undefined {
	return step.started === undefined || step.ended === undefined
		? undefined
		: step.ended - step.started;
}

/** A span in milliseconds, in whole seconds or minutes. */
function span(ms: number): string {
	const seconds = Math.round(ms / 1000);
	return seconds < 60
		? `${seconds}s`
		: `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * The task a target's recap becomes: each flagged step with its error, how it
 * ended and its time against the usual, and the commands to read the run. Null
 * when nothing of the target is flagged.
 */
export function recapText(
	state: RunState,
	target: TargetState,
	slow: Record<string, number>,
): string | null {
	const flagged = target.steps.flatMap((step) => {
		const trouble =
			step.status === "failed" ||
			step.fix !== undefined ||
			(step.retries ?? 0) > 0;
		const usual = slow[step.id];
		const duration = took(step);
		const slowness =
			usual === undefined
				? undefined
				: `${duration === undefined ? "ran" : span(duration)} against the usual ${span(usual)}`;
		if (!trouble && slowness === undefined) {
			return [];
		}
		const failure = step.error ?? step.failure;
		const how: string[] = [];
		if (step.fix !== undefined) {
			how.push(`agent fix #${step.fix.task} ${step.fix.ended ?? "still open"}`);
		}
		if ((step.retries ?? 0) > 0) {
			how.push(`retried ${step.retries} time${step.retries === 1 ? "" : "s"}`);
		}
		if (trouble) {
			how.push(
				step.status === "failed"
					? "still failing"
					: step.status === "done"
						? "passed in the end"
						: "not finished",
			);
		}
		return [
			[
				`### \`${step.id}\`: ${trouble ? "trouble" : "slow"}`,
				"",
				...(failure === undefined
					? []
					: ["Error:", "", "```", failure.trim(), "```", ""]),
				...(how.length === 0 ? [] : [`- Outcome: ${how.join(", ")}`]),
				...(duration === undefined ? [] : [`- Took ${span(duration)}`]),
				...(slowness === undefined ? [] : [`- Slow: ${slowness}`]),
				`- Read it all: \`splates ships show ${state.id} --target ${target.name} --step ${step.id}\``,
			].join("\n"),
		];
	});
	if (flagged.length === 0) {
		return null;
	}
	const failing = target.steps.some((step) => step.status === "failed");
	return [
		"## Before",
		"",
		`The ship run ${state.id} shipped ${target.name}${target.released === undefined ? "" : ` ${target.released}`} with ${flagged.length === 1 ? "a step" : `${flagged.length} steps`} worth a look.`,
		"",
		"## After",
		"",
		failing
			? `The cause of what failed or ran slow in ${target.name} is found and fixed in the code, so the next ship goes clean.`
			: `The cause of what ran slow or needed a retry in ${target.name} is found, and fixed when code can fix it.`,
		"",
		"## Details",
		"",
		"This task comes from a ship's recap, which the user sent to you. Nothing is waiting on it: the ship is over. Investigate each flagged step below; fix what code can fix and land it with `splates merge`. When nothing needs changing (a flaky registry, a slow network), remove the task with `--reason nothing` saying what you found. Never start a ship.",
		"",
		...flagged.flatMap((each) => [each, ""]),
	].join("\n");
}
