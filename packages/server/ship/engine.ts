import type { Resource } from "core/disposable";
import type { IdProvider } from "core/id";
import type { Logger } from "core/log";
import type { WallClock } from "core/time";
import type { Log, Storage } from "../storage";
import { eventOfLine } from "./line-event";
import { RunError } from "./run-error";
import { RUN_EVENT, type RunEvent, type RunTarget } from "./run-events";
import { keyOf, messageOf, requestOf, stepIn, stepsOf } from "./run-lookup";
import {
	applyRunEvent,
	foldRun,
	isActive,
	type RunState,
	readySteps,
} from "./run-state";
import type { DoneAnswer, RunningStep, StepProcesses } from "./step-processes";

/** Read a ship run's file at `${RUNS}/<id>.jsonl` in the project's storage, one event a line. */
export const RUNS = "ship-runs";

/** How often a run cut short checks whether its old process is gone. */
const GONE_POLL_MS = 1000;
/** How long a resumed step waits on its old process before it goes on. */
const GONE_CAP_MS = 10 * 60 * 1000;

/** What hears of a run as it changes: each event and where it leaves the run. */
export type RunListener = (event: RunEvent, state: RunState) => void;

export type ShipEngineOptions = {
	storage: Storage;
	processes: StepProcesses;
	clock: WallClock;
	ids: IdProvider;
	log: Logger;
	/** Waits `ms`, `setTimeout` by default; tests pass their own. */
	wait?: (ms: number) => Promise<void>;
};

type LiveRun = {
	id: string;
	log: Log<RunEvent>;
	state: RunState;
	/** The appends to its file, in order. */
	writes: Promise<void>;
	/** Each step this server has a process at work on, by key. */
	launched: Set<string>;
	/** Each running step's `run`, to answer its prompts. */
	live: Map<string, RunningStep>;
	/** Steps a restart cut short, and the process each was. */
	cutShort: Map<string, number>;
	listeners: Set<RunListener>;
};

/** What a note is about: a step, and a link it points to. */
type NoteAbout = { target: string; step: string; link: string };

/**
 * Runs the ships the user starts: `start` one of composed targets, show it
 * with `get`, `list` and `subscribe`, and steer it with `answer` and
 * `retry`. Call `resume` once as the server starts, so a ship a restart cut
 * short carries on.
 */
export class ShipEngine {
	// Each step runs as its own process through its target's command, steps
	// with no order between them together. Every event goes to the run's file
	// as it happens, so `resume` reads where a run stood and asks `done` again
	// of each step that was mid-flight once its old process is gone.
	readonly #o: ShipEngineOptions;
	readonly #wait: (ms: number) => Promise<void>;
	readonly #runs = new Map<string, LiveRun>();
	readonly #watchers = new Set<(id: string, state: RunState) => void>();
	#loaded: Promise<void> | null = null;
	#disposed = false;

	constructor(opts: ShipEngineOptions) {
		this.#o = opts;
		this.#wait =
			opts.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
	}

	/**
	 * Reads every run file and carries on each run left under way: a step
	 * that was mid-flight waits for its old process to go, then asks `done`.
	 */
	resume(): Promise<void> {
		this.#loaded ??= this.#load();
		return this.#loaded;
	}

	/** Starts a run of `targets`, in the order they ship. */
	async start(targets: RunTarget[]): Promise<RunState> {
		await this.resume();
		this.#refuseWhileActive();
		const id = this.#o.ids.next();
		const run = this.#open(id);
		const started: RunEvent = {
			type: "started",
			at: this.#o.clock.now(),
			targets,
		};
		run.state = foldRun(id, [started]);
		this.#runs.set(id, run);
		run.writes = run.log.append(started);
		await run.writes;
		this.#schedule(run);
		return run.state;
	}

	/** Every run, newest first, or only those in `status` (`running`: the one under way). */
	async list(status?: string): Promise<RunState[]> {
		await this.resume();
		return [...this.#runs.values()]
			.map((run) => run.state)
			.filter((run) => status === undefined || run.status === status)
			.sort((one, other) => other.started - one.started);
	}

	async get(id: string): Promise<RunState | null> {
		await this.resume();
		return this.#runs.get(id)?.state ?? null;
	}

	/** Answers prompt `prompt` of a step waiting on it. */
	async answer(
		id: string,
		target: string,
		step: string,
		prompt: string,
		value: unknown,
	): Promise<RunState> {
		const run = await this.#run(id);
		const found = stepIn(run.state, target, step);
		const open = found.prompts.find((each) => each.id === prompt);
		const running = run.live.get(keyOf(target, step));
		if (open === undefined || running === undefined) {
			throw new RunError(`"${step}" of ${target} is not asking "${prompt}"`);
		}
		const want = { confirm: "boolean", ask: "string", link: undefined }[
			open.prompt.kind
		];
		if (want !== undefined && typeof value !== want) {
			throw new RunError(
				`A ${open.prompt.kind} prompt takes a ${want}, not ${JSON.stringify(value)}`,
				400,
			);
		}
		await running.answer(prompt, value);
		this.#record(run, {
			type: "answered",
			at: this.#o.clock.now(),
			target,
			step,
			id: prompt,
			value,
		});
		return run.state;
	}

	/**
	 * Sends a failed step round again, and what it held back with it: `by`
	 * the user's press, its fix merging, or the agent fixing it.
	 */
	async retry(
		id: string,
		target: string,
		step: string,
		by: "user" | "fix" | "agent" = "user",
		task?: string,
	): Promise<RunState> {
		const run = await this.#run(id);
		if (stepIn(run.state, target, step).status !== "failed") {
			throw new RunError(`"${step}" of ${target} has not failed`);
		}
		if (run.state.status === "stopped") {
			throw new RunError(`The ship ${id} was stopped`);
		}
		this.#refuseWhileActive(id);
		this.#record(run, {
			type: "retried",
			at: this.#o.clock.now(),
			target,
			step,
			...(by !== "user" && { by }),
			...(task !== undefined && { task }),
		});
		this.#schedule(run);
		return run.state;
	}

	/**
	 * Stops run `id`, under way or stopped on a failure: ends every step's
	 * process and records the run as stopped, so a restart leaves it be and the
	 * next ship can start.
	 */
	async stop(id: string): Promise<RunState> {
		const run = await this.#run(id);
		if (run.state.status !== "running" && run.state.status !== "failed") {
			throw new RunError(`The ship ${id} is not under way`);
		}
		this.#record(run, { type: "stopped", at: this.#o.clock.now() });
		for (const step of [...run.live.values()]) {
			step.dispose();
		}
		return run.state;
	}

	/** Adds to run `id` a note from started task `task`, about a step or the run. */
	async note(
		id: string,
		note: { task: string; text: string } & Partial<NoteAbout>,
	): Promise<RunState> {
		const run = await this.#run(id);
		if ((note.target === undefined) !== (note.step === undefined)) {
			throw new RunError("Name both the target and the step, or neither", 400);
		}
		if (note.target !== undefined && note.step !== undefined) {
			stepIn(run.state, note.target, note.step);
		}
		this.#record(run, { type: "noted", at: this.#o.clock.now(), ...note });
		return run.state;
	}

	/** Records that failed step `step` went to an agent as board task `task`. */
	async sent(
		id: string,
		target: string,
		step: string,
		task: number,
	): Promise<RunState> {
		const run = await this.#run(id);
		const found = stepIn(run.state, target, step);
		if (found.status !== "failed") {
			throw new RunError(`"${step}" of ${target} has not failed`);
		}
		if (found.fix !== undefined && found.fix.ended === undefined) {
			throw new RunError(
				`"${step}" of ${target} is already with an agent, as task #${found.fix.task}`,
			);
		}
		this.#record(run, {
			type: "sent",
			at: this.#o.clock.now(),
			target,
			step,
			task,
		});
		return run.state;
	}

	/**
	 * Records how the fix board task `task` ended. One that ended, merged or
	 * removed, sends its step round again when the step is still failed; a step another ship
	 * keeps from going stays failed for the user's Retry.
	 */
	async fixed(
		id: string,
		target: string,
		step: string,
		task: number,
		outcome: "merged" | "removed",
	): Promise<RunState> {
		const run = await this.#run(id);
		const found = stepIn(run.state, target, step);
		if (found.fix?.task !== task || found.fix.ended !== undefined) {
			return run.state;
		}
		this.#record(run, {
			type: "fixed",
			at: this.#o.clock.now(),
			target,
			step,
			task,
			outcome,
		});
		if (found.status === "failed") {
			try {
				return await this.retry(id, target, step, "fix");
			} catch (error) {
				this.#o.log.error(
					`The ship run ${id} could not retry "${step}" of ${target} once its fix ended: ${messageOf(error)}`,
				);
			}
		}
		return run.state;
	}

	/** Tells `listener` of each event of run `id` until disposed. */
	async subscribe(
		id: string,
		listener: RunListener,
	): Promise<{ state: RunState; dispose(): void }> {
		const run = await this.#run(id);
		run.listeners.add(listener);
		return { state: run.state, dispose: () => run.listeners.delete(listener) };
	}

	/** Tells `watcher` of every run as each event leaves it, until disposed. */
	listen(watcher: (id: string, state: RunState) => void): Resource {
		this.#watchers.add(watcher);
		return { dispose: () => void this.#watchers.delete(watcher) };
	}

	/** Waits until every event so far is in its run's file. */
	async flushed(): Promise<void> {
		await Promise.all([...this.#runs.values()].map((run) => run.writes));
	}

	/**
	 * Stops scheduling and recording, leaving each step's process to finish
	 * on its own: a restart's `resume` asks `done` of it once it is gone.
	 */
	async disposeAsync(): Promise<void> {
		this.#disposed = true;
		await this.flushed();
	}

	/**
	 * Lets go of every step a worker runs, without ending it, for a server
	 * started again to take back: each step's run file, flushed, says where
	 * it stopped. Says whether there was one to let go of.
	 */
	async detachAsync(): Promise<boolean> {
		const kept = [...this.#runs.values()].some((run) =>
			[...run.live.values()].some((step) => step.handle != null),
		);
		this.#disposed = true;
		await this.flushed();
		return kept;
	}

	async #load(): Promise<void> {
		const { storage, log } = this.#o;
		const keys = await storage.keys(RUNS).catch(() => [] as string[]);
		for (const key of keys) {
			const name = key.slice(RUNS.length + 1);
			if (!name.endsWith(".jsonl") || name.includes("/")) {
				continue;
			}
			const id = name.slice(0, -".jsonl".length);
			const run = this.#open(id);
			try {
				run.state = foldRun(id, await run.log.replay());
			} catch (error) {
				log.error(`The ship run ${id} could not be read: ${String(error)}`);
				continue;
			}
			this.#runs.set(id, run);
		}
		for (const run of this.#runs.values()) {
			if (run.state.status !== "running") {
				continue;
			}
			for (const { target, step } of stepsOf(run.state)) {
				if (isActive(step.status) && step.pid !== undefined) {
					run.cutShort.set(keyOf(target.name, step.id), step.pid);
				}
			}
			this.#record(run, { type: "resumed", at: this.#o.clock.now() });
			this.#schedule(run);
		}
	}

	#open(id: string): LiveRun {
		return {
			id,
			log: this.#o.storage.log(`${RUNS}/${id}.jsonl`, { schema: RUN_EVENT }),
			state: { id, started: 0, status: "running", targets: [], notes: [] },
			writes: Promise.resolve(),
			launched: new Set(),
			live: new Map(),
			cutShort: new Map(),
			listeners: new Set(),
		};
	}

	async #run(id: string): Promise<LiveRun> {
		await this.resume();
		const run = this.#runs.get(id);
		if (run === undefined) {
			throw new RunError(`No ship run is "${id}"`, 404);
		}
		return run;
	}

	/** Refuses while a run other than `except` is under way. */
	#refuseWhileActive(except?: string): void {
		for (const run of this.#runs.values()) {
			if (run.id !== except && run.state.status === "running") {
				throw new RunError(
					`The ship ${run.id} is still under way: one runs at a time`,
				);
			}
		}
	}

	#record(run: LiveRun, event: RunEvent): void {
		if (this.#disposed) {
			return;
		}
		run.state = applyRunEvent(run.state, event);
		run.writes = run.writes
			.then(() => run.log.append(event))
			.catch((error: unknown) =>
				this.#o.log.error(
					`The ship run ${run.id} could not keep an event: ${String(error)}`,
				),
			);
		for (const listener of run.listeners) {
			listener(event, run.state);
		}
		for (const watcher of this.#watchers) {
			watcher(run.id, run.state);
		}
	}

	#schedule(run: LiveRun): void {
		if (this.#disposed || run.state.status === "stopped") {
			return;
		}
		for (const { target, step } of readySteps(run.state)) {
			const key = keyOf(target.name, step.id);
			if (!run.launched.has(key)) {
				run.launched.add(key);
				void this.#launch(run, target.name, step.id)
					.catch((error: unknown) =>
						this.#o.log.error(
							`The ship run ${run.id} lost "${step.id}" of ${target.name}: ${String(error)}`,
						),
					)
					.finally(() => {
						run.launched.delete(key);
						this.#schedule(run);
					});
			}
		}
	}

	async #launch(run: LiveRun, target: string, step: string): Promise<void> {
		const key = keyOf(target, step);
		const before = run.cutShort.get(key);
		// A step a worker kept through the restart is taken back where it
		// stood; one it cannot, or that has none, is waited out as it was.
		const kept = stepIn(run.state, target, step);
		let taken: RunningStep | null = null;
		if (kept.handle !== undefined && this.#o.processes.resume !== undefined) {
			try {
				taken = this.#o.processes.resume(
					requestOf(run.state, target, step),
					kept.handle,
					kept.held ?? 0,
				);
			} catch (error) {
				this.#o.log.error(
					`The ship run ${run.id} could not take back "${step}" of ${target}: ${messageOf(error)}`,
				);
			}
		}
		if (taken === null && before !== undefined) {
			await this.#gone(before);
		}
		run.cutShort.delete(key);
		if (this.#disposed || run.state.status === "stopped") {
			taken?.dispose();
			return;
		}
		if (taken !== null) {
			if (await this.#follow(run, target, step, taken, true)) {
				return;
			}
			if (this.#disposed || this.#stopped(run)) {
				return;
			}
		}
		const at = () => this.#o.clock.now();
		const ended = this.#ender(run, target, step);
		this.#record(run, { type: "checking", at: at(), target, step });
		const request = requestOf(run.state, target, step);
		let answer: DoneAnswer;
		try {
			answer = await this.#o.processes.done(request);
		} catch (error) {
			ended("failed", messageOf(error));
			return;
		}
		if (answer.released !== undefined) {
			this.#record(run, {
				type: "released",
				target,
				step,
				version: answer.released,
			});
		}
		if (answer.done) {
			ended("skipped");
			return;
		}
		if (this.#stopped(run)) {
			return;
		}
		await this.#follow(
			run,
			target,
			step,
			this.#o.processes.run(request),
			false,
		);
	}

	/**
	 * Records what `running`, the `run` of a step, does until it exits, and
	 * how it ended. Answers false for one taken back that the worker no longer
	 * holds, which leaves the step to be checked and run again.
	 */
	async #follow(
		run: LiveRun,
		target: string,
		step: string,
		running: RunningStep,
		taken: boolean,
	): Promise<boolean> {
		const key = keyOf(target, step);
		const at = () => this.#o.clock.now();
		const ended = this.#ender(run, target, step);
		run.live.set(key, running);
		this.#record(run, {
			type: "running",
			at: at(),
			target,
			step,
			pid: running.pid ?? 0,
			...(running.handle != null && { handle: running.handle }),
		});
		let failure: string | undefined;
		let heard = false;
		let acked = stepIn(run.state, target, step).held;
		try {
			for await (const line of running.lines) {
				heard = true;
				const read = eventOfLine(line, target, step, at());
				if ("failure" in read) {
					failure = read.failure;
				} else {
					this.#record(run, read);
				}
				const seq = running.held;
				if (seq != null && seq !== acked) {
					acked = seq;
					this.#record(run, { type: "held", target, step, seq });
					void run.writes.then(() => running.ack?.(seq));
				}
			}
		} catch (error) {
			failure ??= `Its output broke off: ${messageOf(error)}`;
		}
		const code = await running.exited;
		run.live.delete(key);
		if (taken && !heard && code === 127 && failure === undefined) {
			return false;
		}
		if (code === 0) {
			ended("done");
		} else {
			ended("failed", failure ?? `"${step}" exited ${code}`);
		}
		return true;
	}

	/** Whether run `run` is stopped, read afresh: it changes while a step awaits. */
	#stopped(run: LiveRun): boolean {
		return run.state.status === "stopped";
	}

	/** Records how `step` of `target` ended. */
	#ender(run: LiveRun, target: string, step: string) {
		return (outcome: "done" | "skipped" | "failed", error?: string) =>
			this.#record(run, {
				type: "ended",
				at: this.#o.clock.now(),
				target,
				step,
				outcome,
				...(error !== undefined && { error }),
			});
	}

	/** Resolves once process `pid` is gone, or once it has had long enough. */
	async #gone(pid: number): Promise<void> {
		for (
			let waited = 0;
			waited < GONE_CAP_MS && pid > 0 && this.#o.processes.alive(pid);
			waited += GONE_POLL_MS
		) {
			await this.#wait(GONE_POLL_MS);
		}
	}
}
