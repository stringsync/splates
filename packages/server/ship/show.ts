import type { Storage } from "../storage";
import { RUNS } from "./engine";
import { RUN_EVENT, type RunEvent } from "./run-events";
import { foldRun, type RunState, type StepState } from "./run-state";

/**
 * The ship runs kept in a project's storage, each folded from its file:
 * what `splates ships` reads with or without a server.
 */
export class KeptRuns {
	constructor(private readonly storage: Storage) {}

	/** Every run, newest first. */
	async list(): Promise<RunState[]> {
		const keys = await this.storage.keys(RUNS).catch(() => [] as string[]);
		const runs: RunState[] = [];
		for (const key of keys) {
			const name = key.slice(RUNS.length + 1);
			if (!name.endsWith(".jsonl") || name.includes("/")) {
				continue;
			}
			const found = await this.read(name.slice(0, -".jsonl".length));
			if (found !== null) {
				runs.push(found.state);
			}
		}
		return runs.sort((one, other) => other.started - one.started);
	}

	/** Run `id`'s events and where they leave it, or null for none kept. */
	async read(
		id: string,
	): Promise<{ state: RunState; events: RunEvent[] } | null> {
		if (id === "" || id.includes("/")) {
			return null;
		}
		const events = await this.storage
			.log(`${RUNS}/${id}.jsonl`, { schema: RUN_EVENT })
			.replay()
			.catch(() => [] as RunEvent[]);
		if (events.length === 0) {
			return null;
		}
		return { state: foldRun(id, events), events };
	}
}

/** Run `run` in one line: id, status, start, targets and what failed. */
export function runLine(run: RunState): string {
	const failed = run.targets.flatMap((target) =>
		target.steps
			.filter((step) => step.status === "failed")
			.map((step) => `${target.name}/${step.id}`),
	);
	const started = new Date(run.started).toISOString();
	const names = run.targets.map((each) => each.name).join(", ");
	return `${run.id}  ${run.status.padEnd(7)}  ${started}  ${names}${failed.length === 0 ? "" : `  failed: ${failed.join(", ")}`}`;
}

/** Everything step `step` of `target` printed on its last try, from the run file. */
export function stepOutput(
	events: readonly RunEvent[],
	target: string,
	step: string,
): string {
	let text = "";
	for (const event of events) {
		if (!("step" in event) || event.target !== target || event.step !== step) {
			continue;
		}
		if (event.type === "checking") {
			text = "";
		} else if (event.type === "output") {
			text += event.text;
		}
	}
	return text;
}

/** Run `state` as lines for a terminal: each target, its steps, errors and fixes. */
export function describeRun(state: RunState): string {
	const lines = [
		`ship run ${state.id}: ${state.status}, started ${new Date(state.started).toISOString()}`,
	];
	for (const target of state.targets) {
		const facts = [
			target.version ?? target.bump,
			target.released === undefined ? undefined : `released ${target.released}`,
			target.dependencies.length === 0
				? undefined
				: `after ${target.dependencies.join(", ")}`,
		].filter((each) => each !== undefined);
		lines.push(
			`  ${target.name}${facts.length === 0 ? "" : ` (${facts.join(", ")})`}`,
		);
		const width = Math.max(...target.steps.map((each) => each.id.length));
		for (const step of target.steps) {
			lines.push(
				`    ${step.id.padEnd(width)}  ${step.status.padEnd(8)}  ${step.does}`,
			);
			lines.push(...stepFacts(step).map((each) => `      ${each}`));
		}
	}
	if (state.notes.length > 0) {
		lines.push("  notes");
		for (const note of state.notes) {
			const about =
				note.target === undefined ? "run" : `${note.target}/${note.step}`;
			const link = note.link === undefined ? "" : ` (${note.link})`;
			lines.push(
				`    ${new Date(note.at).toISOString()}  ${about}  ${note.task}: ${note.text.split("\n").join("\n      ")}${link}`,
			);
		}
	}
	return lines.join("\n");
}

function stepFacts(step: StepState): string[] {
	const facts: string[] = [];
	if (step.update !== undefined && step.status !== "pending") {
		facts.push(`update: ${step.update}`);
	}
	if (step.error !== undefined) {
		facts.push(`error: ${step.error.split("\n").join("\n        ")}`);
	}
	if (step.fix !== undefined) {
		const how =
			step.fix.ended === undefined
				? "with an agent"
				: step.fix.ended === "merged"
					? "merged"
					: "removed without merging";
		facts.push(`fix: task #${step.fix.task}, ${how}`);
	}
	if ((step.retries ?? 0) > 0) {
		facts.push(`retried ${step.retries}×`);
	}
	return facts;
}
