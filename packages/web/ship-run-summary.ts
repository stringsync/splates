import type {
	OpenPrompt,
	RunState,
	StepState,
	TargetState,
} from "@splates/server/ship";
import { waves } from "@splates/server/ship/browser";

/** Where a target stands, from its steps, as its card shows it. */
export type TargetStatus =
	| "waiting"
	| "running"
	| "done"
	| "failed"
	| "stopped";

export type TargetSummary = {
	name: string;
	status: TargetStatus;
	/** The line under its name: its latest update, why it failed, or when it starts. */
	line: string;
	/** When its first step started, and its last ended once it is done or failed. */
	started?: number;
	ended?: number;
	/** Every step in order, as the card's rail lists them. */
	steps: StepState[];
	/** Its failed steps, each to retry. */
	failed: StepState[];
	/** Waits on the user to answer a prompt. */
	asking: boolean;
	prompts: StepPrompt[];
	/** The sign-in links its running steps went through. */
	signedIn: { step: string; url: string }[];
	/** Each step's agent fix, at work or ended, in step order. */
	fixes: StepFix[];
};

/** A prompt open on one of a target's steps. */
export type StepPrompt = OpenPrompt & { step: string; does: string };

export type RunSummary = {
	/** The targets in steps run in order, the targets of a step together. */
	steps: TargetSummary[][];
	done: number;
	total: number;
	/** Every target's steps finished, and how many there are, for a bar that moves step by step. */
	finished: number;
	count: number;
};

/** `run` as the run view shows it: its targets in steps, each summed up. */
export function summarize(run: RunState): RunSummary {
	const byName = new Map(run.targets.map((each) => [each.name, each]));
	const order = waves(
		run.targets.map((each) => ({
			id: each.name,
			dependencies: each.dependencies,
		})),
		"target",
	);
	const steps = order.map((wave, index) =>
		wave.flatMap((name) => {
			const target = byName.get(name);
			return target === undefined ? [] : [summarizeTarget(target, index)];
		}),
	);
	const all = steps.flat();
	const every = run.targets.flatMap((each) => each.steps);
	return {
		steps,
		done: all.filter((each) => each.status === "done").length,
		total: all.length,
		finished: every.filter((each) => FINISHED.has(each.status)).length,
		count: every.length,
	};
}

function summarizeTarget(target: TargetState, step: number): TargetSummary {
	const { steps } = target;
	const failed = steps.filter((each) => each.status === "failed");
	const started = steps
		.map((each) => each.started)
		.filter((at): at is number => at !== undefined);
	const ended = steps
		.map((each) => each.ended)
		.filter((at): at is number => at !== undefined);
	const status: TargetStatus = steps.some((each) => each.status === "stopped")
		? "stopped"
		: failed.length > 0
			? "failed"
			: steps.every((each) => FINISHED.has(each.status))
				? "done"
				: steps.some(
							(each) => ACTIVE.has(each.status) || FINISHED.has(each.status),
						) && !steps.some((each) => each.status === "blocked")
					? "running"
					: "waiting";
	const summary = {
		name: target.name,
		status,
		steps,
		failed,
		asking: steps.some((each) => each.status === "waiting"),
		prompts: steps.flatMap((each) =>
			each.prompts.map((open) => ({ ...open, step: each.id, does: each.does })),
		),
		signedIn:
			status === "running"
				? steps.flatMap((each) =>
						each.signedIn === undefined
							? []
							: [{ step: each.id, url: each.signedIn }],
					)
				: [],
		fixes: steps.flatMap((each) =>
			each.fix === undefined
				? []
				: [
						{
							step: each.id,
							task: each.fix.task,
							...(each.fix.ended !== undefined && { ended: each.fix.ended }),
							...(each.fix.note !== undefined && { note: each.fix.note }),
						},
					],
		),
		...(started.length > 0 && { started: Math.min(...started) }),
		...(status !== "running" &&
			ended.length > 0 && { ended: Math.max(...ended) }),
	};
	return { ...summary, line: lineOf(target, status, step) };
}

/** The line under a target's name. */
function lineOf(
	target: TargetState,
	status: TargetStatus,
	step: number,
): string {
	const { steps } = target;
	if (status === "stopped") {
		return "Stopped by you";
	}
	if (status === "failed") {
		const failed = steps.find((each) => each.status === "failed");
		return (
			firstLine(failed?.error) ?? failed?.update ?? `${failed?.does} failed`
		);
	}
	if (status === "waiting") {
		if (steps.some((each) => each.status === "blocked")) {
			return "Held back by a failed or stopped step";
		}
		return step === 0 ? "Starting" : `Starts when group ${step} is done`;
	}
	if (status === "running") {
		const active = steps.find((each) => ACTIVE.has(each.status));
		if (active?.status === "waiting") {
			return "Waiting on you";
		}
		if (active?.status === "checking") {
			return active.update ?? `Checking: ${active.does}`;
		}
		return active?.update ?? active?.does ?? latestUpdate(steps) ?? "Running";
	}
	return latestUpdate(steps) ?? "Done";
}

/** The update of the step that ended last and said one. */
function latestUpdate(steps: StepState[]): string | undefined {
	return [...steps]
		.filter((each) => each.update !== undefined)
		.sort((one, other) => (one.ended ?? 0) - (other.ended ?? 0))
		.at(-1)?.update;
}

function firstLine(text: string | undefined): string | undefined {
	return text
		?.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.at(0);
}

const ACTIVE = new Set(["checking", "running", "waiting"]);
const FINISHED = new Set(["done", "skipped"]);

/** A step sent to an agent: its board task, and how it ended, absent while at work. */
export type StepFix = {
	step: string;
	task: number;
	ended?: "merged" | "removed" | "abandoned";
	/** What the agent last said, for a fix it abandoned. */
	note?: string;
};
