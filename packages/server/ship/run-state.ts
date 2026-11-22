import type { Prompt, RunEvent, RunTarget, Supervise } from "./run-events";
import type { Bump } from "./wire";

/**
 * Where a run stands: under way, every step done, stopped on a failure, or
 * stopped by the user.
 */
export type RunStatus = "running" | "done" | "failed" | "stopped";

export type RunState = {
	id: string;
	started: number;
	status: RunStatus;
	/** The commit its steps run on, from its own checkout; none for a run in the main tree. */
	commit?: string;
	/** In the order they ship. */
	targets: TargetState[];
	/** What agents added, in the order they did. */
	notes: RunNote[];
	/** Present while the server sends failed steps to agents by itself. */
	supervise?: Supervision;
	/** Whether confirm prompts are answered Yes by the server; off when absent. */
	autoApprove?: boolean;
};

/**
 * A supervised run's fixes: `budget` the server may send by itself, and
 * `spent` the ones it has sent; once they meet, a failure waits for the user.
 */
export type Supervision = { budget: number; spent: number };

/** A note an agent added to a run, about one of its steps or the run as a whole. */
export type RunNote = {
	at: number;
	task: string;
	text: string;
	target?: string;
	step?: string;
	link?: string;
};

/**
 * Where a step stands. `blocked` is a pending step a failed step it depends
 * on holds back, directly or through another; `waiting` one whose `run` has
 * asked and waits on the user.
 */
export type StepStatus =
	| "pending"
	| "blocked"
	| "checking"
	| "running"
	| "waiting"
	| "done"
	| "skipped"
	| "failed"
	| "stopped";

/** A prompt a running step waits on an answer to. */
export type OpenPrompt = { id: string; prompt: Prompt; at: number };

export type StepState = {
	id: string;
	does: string;
	dependencies: string[];
	status: StepStatus;
	/** The process of its `run` while it runs, or of the last one cut short. */
	pid?: number;
	/** Where a worker keeps its process, for a restart to take it back. */
	handle?: { worker: string; channel: number };
	/** The last frame of its process written down in the run file. */
	held?: number;
	/** The step's line, as it last updated it. */
	update?: string;
	/** The last {@link OUTPUT_LINES} lines its commands printed. */
	output: string[];
	prompts: OpenPrompt[];
	/** The sign-in link it last asked, once the user went through it, until it runs again. */
	signedIn?: string;
	error?: string;
	/** What the step last failed with, still readable once a retry clears `error`. */
	failure?: string;
	started?: number;
	ended?: number;
	/** The agent's fix it was last sent for, from its sending on. */
	fix?: StepFix;
	/** The fixes it was sent for before `fix`, oldest first. */
	earlier?: StepFix[];
	/**
	 * Its last fix was removed without merging: the agent gave up, so the
	 * step waits for the user, unsupervised, until it is sent round again.
	 */
	handedBack?: boolean;
	/** How many times it was sent round again after failing. */
	retries?: number;
};

/**
 * A failed step's fix: board task `task`, and how it ended, absent while the
 * agent is at work on it.
 */
export type StepFix = {
	task: number;
	at: number;
	ended?: "merged" | "removed" | "abandoned";
	/** What the agent last said, for a fix it abandoned. */
	note?: string;
};

export type TargetState = {
	name: string;
	command: string;
	bump?: Bump;
	/** The exact version every step takes, in place of the bump. */
	version?: string;
	dependencies: string[];
	steps: StepState[];
	/** What it released, once a step of it says. */
	released?: string;
	/** The board task its recap was sent to an agent as, once the user sent it. */
	recap?: { task: number; at: number };
};

/** How many of a step's last output lines its state shows; the run file has them all. */
export const OUTPUT_LINES = 200;

/** `events`, a run file's lines, folded into where the run `id` stands. */
export function foldRun(id: string, events: readonly RunEvent[]): RunState {
	const [first, ...rest] = events;
	if (first?.type !== "started") {
		throw new Error(`The run "${id}" does not begin with its start`);
	}
	let state = startedRun(
		id,
		first.at,
		first.targets,
		first.supervise,
		first.commit,
		first.autoApprove,
	);
	for (const event of rest) {
		state = applyRunEvent(state, event);
	}
	return state;
}

function startedRun(
	id: string,
	at: number,
	targets: RunTarget[],
	supervise?: Supervise,
	commit?: string,
	autoApprove = false,
): RunState {
	return settle({
		id,
		autoApprove,
		started: at,
		...(commit !== undefined && { commit }),
		status: "running",
		notes: [],
		...(supervise !== undefined && {
			supervise: { budget: supervise.budget, spent: 0 },
		}),
		targets: targets.map((target) => ({
			name: target.name,
			command: target.command,
			...(target.bump && { bump: target.bump }),
			...(target.version !== undefined && { version: target.version }),
			dependencies: target.dependencies,
			steps: target.steps.map((step) => ({
				id: step.id,
				does: step.does,
				dependencies: step.dependencies ?? [],
				status: "pending",
				output: [],
				prompts: [],
			})),
		})),
	});
}

/** `state` after `event`, a new state, `state` left as it was. */
export function applyRunEvent(state: RunState, event: RunEvent): RunState {
	if (event.type === "started") {
		return startedRun(
			state.id,
			event.at,
			event.targets,
			event.supervise,
			event.commit,
			event.autoApprove,
		);
	}
	if (event.type === "auto-approval") {
		return { ...state, autoApprove: event.on };
	}
	if (event.type === "supervised") {
		return {
			...state,
			supervise: { budget: event.budget, spent: state.supervise?.spent ?? 0 },
		};
	}
	if (event.type === "advanced") {
		return { ...state, commit: event.commit };
	}
	if (event.type === "stopped") {
		return {
			...state,
			status: "stopped",
			targets: state.targets.map((target) => ({
				...target,
				steps: target.steps.map((step) =>
					isActive(step.status)
						? { ...step, status: "pending", prompts: [] }
						: step,
				),
			})),
		};
	}
	if (event.type === "target-stopped") {
		if (state.status === "stopped") {
			return state;
		}
		return settle({
			...state,
			targets: state.targets.map((target) =>
				target.name === event.target
					? {
							...target,
							steps: target.steps.map((step) =>
								isFinished(step.status)
									? step
									: { ...step, status: "stopped", prompts: [] },
							),
						}
					: target,
			),
		});
	}
	if (event.type === "resumed") {
		return settle({
			...state,
			status: "running",
			targets: state.targets.map((target) => ({
				...target,
				steps: target.steps.map((step) =>
					isActive(step.status)
						? {
								...step,
								status: "pending",
								// What a worker holds is taken back still asking.
								prompts: step.handle === undefined ? [] : step.prompts,
							}
						: step,
				),
			})),
		});
	}
	if (event.type === "recapped") {
		return {
			...state,
			targets: state.targets.map((target) =>
				target.name === event.target
					? { ...target, recap: { task: event.task, at: event.at } }
					: target,
			),
		};
	}
	if (event.type === "noted") {
		const { type: _, ...note } = event;
		return { ...state, notes: [...state.notes, note] };
	}
	if (state.status === "stopped") {
		// How a fix ended is kept even on a stopped run, so its end is seen once.
		return event.type === "fixed"
			? { ...state, targets: targetsAfter(state, event) }
			: state;
	}
	const spent =
		event.type === "sent" && event.by === "supervisor" && state.supervise
			? { supervise: { ...state.supervise, spent: state.supervise.spent + 1 } }
			: {};
	return settle({ ...state, ...spent, targets: targetsAfter(state, event) });
}

/** `state`'s targets with `event` applied to the step it names. */
function targetsAfter(
	state: RunState,
	event: Extract<RunEvent, { target: string; step: string }>,
): TargetState[] {
	return state.targets.map((target) => {
		if (target.name !== event.target) {
			return target;
		}
		const steps = target.steps.map((step) =>
			step.id === event.step ? stepAfter(step, event) : step,
		);
		return {
			...target,
			steps,
			...(event.type === "released" && { released: event.version }),
		};
	});
}

function stepAfter(step: StepState, event: RunEvent): StepState {
	if (step.status === "stopped") {
		// What a stopped step's cut-short process still reports changes nothing.
		return step;
	}
	switch (event.type) {
		case "checking": {
			const { error: _, signedIn: __, handle: ___, held: ____, ...rest } = step;
			return { ...rest, status: "checking", started: event.at, prompts: [] };
		}
		case "running": {
			const { handle: _, ...rest } = step;
			return {
				...rest,
				// A step taken back after a restart still waits on what it asked.
				status: step.prompts.length > 0 ? "waiting" : "running",
				pid: event.pid,
				...(event.handle !== undefined && { handle: event.handle }),
			};
		}
		case "held":
			return { ...step, held: event.seq };
		case "output":
			return { ...step, output: kept(step.output, event.text) };
		case "update":
			return { ...step, update: event.line };
		case "prompt":
			return {
				...step,
				status: "waiting",
				prompts: [
					...step.prompts,
					{ id: event.id, prompt: event.prompt, at: event.at },
				],
			};
		case "answered":
		case "withdrawn": {
			const settled = step.prompts.find((each) => each.id === event.id);
			const prompts = step.prompts.filter((each) => each.id !== event.id);
			return {
				...step,
				prompts,
				...(settled?.prompt.kind === "link" && {
					signedIn: settled.prompt.url,
				}),
				...(step.status === "waiting" &&
					prompts.length === 0 && { status: "running" }),
			};
		}
		case "ended":
			return {
				...step,
				status: event.outcome,
				ended: event.at,
				prompts: [],
				...(event.error !== undefined && { error: event.error }),
			};
		case "retried": {
			const {
				error: _,
				ended: __,
				signedIn: ___,
				handle: ____,
				held: _____,
				handedBack,
				...rest
			} = step;
			return {
				...rest,
				// The ship's own try after an agent ended without acting is the
				// one go before the user; if it fails again the step stays handed
				// back, so no new fix goes out each time it fails.
				...(event.by === "fix" && handedBack === true && { handedBack }),
				status: "pending",
				prompts: [],
				retries: (step.retries ?? 0) + 1,
				...((step.error ?? step.failure) !== undefined && {
					failure: step.error ?? step.failure,
				}),
			};
		}
		case "sent":
			return {
				...step,
				fix: { task: event.task, at: event.at },
				...(step.fix !== undefined && {
					earlier: [...(step.earlier ?? []), step.fix],
				}),
			};
		case "fixed":
			return step.fix?.task === event.task
				? {
						...step,
						fix: {
							...step.fix,
							ended: event.outcome,
							...(event.note !== undefined && { note: event.note }),
						},
						...(event.outcome !== "merged" && { handedBack: true }),
					}
				: step;
		default:
			return step;
	}
}

/** `lines` with `text` added, its last line joined to an unfinished one. */
function kept(lines: string[], text: string): string[] {
	const out = [...lines];
	const pieces = text.split("\n");
	const last = out.pop();
	if (last !== undefined) {
		out.push(last + (pieces.shift() ?? ""));
	}
	out.push(...pieces);
	return out.slice(-OUTPUT_LINES);
}

/** Whether a step in `status` has a process at work on it. */
export function isActive(status: StepStatus): boolean {
	return status === "checking" || status === "running" || status === "waiting";
}

/** Whether a step in `status` is behind it. */
function isFinished(status: StepStatus): boolean {
	return status === "done" || status === "skipped";
}

/**
 * `state` with each pending step marked blocked or not, and the run's status
 * worked out from its steps.
 */
function settle(state: RunState): RunState {
	const failed = new Set<string>();
	const keyOf = (target: string, step: string) => `${target}\n${step}`;
	const byName = new Map(state.targets.map((each) => [each.name, each]));
	// Targets are in shipping order and their steps can be in any, so this
	// repeats until nothing more is held back.
	const holds = (target: TargetState, step: StepState): boolean =>
		step.dependencies.some((each) => failed.has(keyOf(target.name, each))) ||
		target.dependencies.some((name) => {
			const upstream = byName.get(name);
			return upstream?.steps.some((each) =>
				failed.has(keyOf(upstream.name, each.id)),
			);
		});
	for (const target of state.targets) {
		for (const step of target.steps) {
			if (step.status === "failed" || step.status === "stopped") {
				failed.add(keyOf(target.name, step.id));
			}
		}
	}
	for (let grew = true; grew; ) {
		grew = false;
		for (const target of state.targets) {
			for (const step of target.steps) {
				const key = keyOf(target.name, step.id);
				if (
					!failed.has(key) &&
					(step.status === "pending" || step.status === "blocked") &&
					holds(target, step)
				) {
					failed.add(key);
					grew = true;
				}
			}
		}
	}
	const targets = state.targets.map((target) => ({
		...target,
		steps: target.steps.map((step): StepState => {
			if (step.status !== "pending" && step.status !== "blocked") {
				return step;
			}
			const status = failed.has(keyOf(target.name, step.id))
				? "blocked"
				: "pending";
			return status === step.status ? step : { ...step, status };
		}),
	}));
	const steps = targets.flatMap((target) => target.steps);
	const status: RunStatus = steps.every((step) => isFinished(step.status))
		? "done"
		: steps.some((step) => isActive(step.status) || step.status === "pending")
			? "running"
			: steps.some((step) => step.status === "failed")
				? "failed"
				: "done";
	return { ...state, status, targets };
}

/**
 * The pending steps of `state` free to start: every step they depend on
 * done or skipped, and every target of the run their target depends on
 * through.
 */
export function readySteps(
	state: RunState,
): { target: TargetState; step: StepState }[] {
	const byName = new Map(state.targets.map((each) => [each.name, each]));
	const through = (name: string): boolean => {
		const target = byName.get(name);
		return (
			target === undefined ||
			target.steps.every((each) => isFinished(each.status))
		);
	};
	const ready: { target: TargetState; step: StepState }[] = [];
	for (const target of state.targets) {
		if (!target.dependencies.every(through)) {
			continue;
		}
		const finished = new Set(
			target.steps
				.filter((each) => isFinished(each.status))
				.map((each) => each.id),
		);
		for (const step of target.steps) {
			if (
				step.status === "pending" &&
				step.dependencies.every(
					(each) =>
						finished.has(each) ||
						!target.steps.some((other) => other.id === each),
				)
			) {
				ready.push({ target, step });
			}
		}
	}
	return ready;
}
