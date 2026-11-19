// vet-ignore-file compact-files: every event of a run goes through its one record path here, the user's steering, the supervisor's and the steps' own alike
import type { Resource } from "core/disposable";
import type { IdProvider } from "core/id";
import type { Logger } from "core/log";
import type { WallClock } from "core/time";
import type { Log, Storage } from "../storage";
import { eventOfLine } from "./line-event";
import { RunError } from "./run-error";
import {
	RUN_EVENT,
	type RunEvent,
	type RunTarget,
	type Supervise,
} from "./run-events";
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
	/**
	 * Pins each run to the commit it started on, in a checkout of its own;
	 * without it, every step runs in the main tree.
	 */
	checkouts?: RunCheckouts;
	/** Waits `ms`, `setTimeout` by default; tests pass their own. */
	wait?: (ms: number) => Promise<void>;
};

/** A checkout of its own for each run, so its steps all run on one commit. */
export interface RunCheckouts {
	/** The main tree's commit, which a run starts on. */
	head(): Promise<string>;
	/** Run `run`'s checkout, made at `commit` and readied when it is missing. */
	ready(run: string, commit: string): Promise<string>;
	/**
	 * Takes landed commit `landed` into run `run`'s checkout, which stands on
	 * `commit`, answering the commit it stands on after; throws when it will
	 * not apply.
	 */
	apply(run: string, commit: string, landed: string): Promise<string>;
	/** Removes run `run`'s checkout, if it has one. */
	release(run: string): Promise<void>;
}

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
	/** Its checkout, once readied; dropped as the checkout is released. */
	checkout: Promise<string> | null;
	/** Whether its checkout was released, the run being over. */
	released: boolean;
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

	/**
	 * Starts a run of `targets`, in the order they ship, supervised with a
	 * budget of fixes when `supervise` is given.
	 */
	async start(targets: RunTarget[], supervise?: Supervise): Promise<RunState> {
		await this.resume();
		this.#refuseWhileActive();
		const commit = await this.#o.checkouts?.head();
		const id = this.#o.ids.next();
		const run = this.#open(id);
		const started: RunEvent = {
			type: "started",
			at: this.#o.clock.now(),
			targets,
			...(supervise !== undefined && { supervise }),
			...(commit !== undefined && { commit }),
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

	/**
	 * Gives run `id`'s supervisor `fixes` more fixes to send by itself,
	 * switching supervision on when it was off.
	 */
	async supervise(id: string, fixes: number): Promise<RunState> {
		const run = await this.#run(id);
		if (run.state.status !== "running" && run.state.status !== "failed") {
			throw new RunError(`The ship ${id} is not under way`);
		}
		const supervise = run.state.supervise;
		// Unsupervised, the budget counts from the fixes spent so far: none.
		const budget = (supervise?.budget ?? 0) + fixes;
		this.#record(run, { type: "supervised", at: this.#o.clock.now(), budget });
		return run.state;
	}

	/**
	 * Records that failed step `step` went to an agent as board task `task`,
	 * by the user or, spending one of its fixes, the supervisor.
	 */
	async sent(
		id: string,
		target: string,
		step: string,
		task: number,
		by?: "supervisor",
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
			...(by !== undefined && { by }),
		});
		return run.state;
	}

	/**
	 * Records how the fix board task `task` ended. One that merged sends its
	 * step round again when the step is still failed; a step another ship
	 * keeps from going stays failed for the user's Retry. One removed means
	 * the agent gave up, so the step waits for the user.
	 */
	async fixed(
		id: string,
		target: string,
		step: string,
		task: number,
		outcome: "merged" | "removed",
		/** The commit a merged fix landed as, for the run's checkout to take in. */
		landed?: string,
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
		if (
			found.status === "failed" &&
			outcome === "merged" &&
			!(await this.#advance(run, task, landed, target, step))
		) {
			return run.state;
		}
		if (outcome === "merged" && found.status === "failed") {
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

	/**
	 * Takes the commit fix task `task` landed as into the run's checkout, so
	 * its retry runs with the fix and nothing else that landed since. Says
	 * whether the step may go round again; when the fix will not apply, the
	 * step stays failed, saying why.
	 */
	async #advance(
		run: LiveRun,
		task: number,
		landed: string | undefined,
		target: string,
		step: string,
	): Promise<boolean> {
		const checkouts = this.#o.checkouts;
		const commit = run.state.commit;
		if (checkouts === undefined || commit === undefined) {
			return true;
		}
		const fail = (why: string) => {
			this.#ender(
				run,
				target,
				step,
			)(
				"failed",
				`Fix #${task} merged, but the ship's checkout at ${commit.slice(0, 12)} could not take it in: ${why}. Retry once the fix applies there, or stop this ship and start a new one.`,
			);
			return false;
		};
		if (landed === undefined) {
			return fail("splates did not find the commit it landed as");
		}
		try {
			await this.#checkout(run);
			const next = await checkouts.apply(run.id, commit, landed);
			this.#record(run, {
				type: "advanced",
				at: this.#o.clock.now(),
				task,
				commit: next,
			});
			return true;
		} catch (error) {
			return fail(messageOf(error));
		}
	}

	/** The run's checkout, readied once; the main tree's (undefined) for a run without one. */
	async #checkout(run: LiveRun): Promise<string | undefined> {
		const checkouts = this.#o.checkouts;
		const commit = run.state.commit;
		if (checkouts === undefined || commit === undefined) {
			return undefined;
		}
		run.checkout ??= checkouts.ready(run.id, commit).catch((error: unknown) => {
			run.checkout = null;
			throw new Error(
				`The ship's checkout of ${commit.slice(0, 12)} could not be made: ${messageOf(error)}`,
			);
		});
		return run.checkout;
	}

	/** Removes the checkout of a run that is over, once nothing runs in it. */
	#releaseIfOver(run: LiveRun): void {
		const checkouts = this.#o.checkouts;
		if (
			checkouts === undefined ||
			run.released ||
			this.#disposed ||
			run.state.commit === undefined ||
			(run.state.status !== "done" && run.state.status !== "stopped") ||
			run.launched.size > 0
		) {
			return;
		}
		run.released = true;
		run.checkout = null;
		void checkouts
			.release(run.id)
			.catch((error: unknown) =>
				this.#o.log.error(
					`The ship run ${run.id} could not remove its checkout: ${messageOf(error)}`,
				),
			);
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
				this.#releaseIfOver(run);
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
			checkout: null,
			released: false,
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
			this.#releaseIfOver(run);
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
		this.#releaseIfOver(run);
	}

	async #launch(run: LiveRun, target: string, step: string): Promise<void> {
		const key = keyOf(target, step);
		const before = run.cutShort.get(key);
		// A step a worker kept through the restart is taken back where it
		// stood; one it cannot, or that has none, is waited out as it was.
		const kept = stepIn(run.state, target, step);
		let cwd: string | undefined;
		try {
			cwd = await this.#checkout(run);
		} catch (error) {
			if (before !== undefined) {
				await this.#gone(before);
			}
			run.cutShort.delete(key);
			if (!this.#disposed && !this.#stopped(run)) {
				this.#ender(run, target, step)("failed", messageOf(error));
			}
			return;
		}
		const request = () => ({
			...requestOf(run.state, target, step),
			...(cwd !== undefined && { cwd }),
		});
		let taken: RunningStep | null = null;
		if (kept.handle !== undefined && this.#o.processes.resume !== undefined) {
			try {
				taken = this.#o.processes.resume(
					request(),
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
		const asked = request();
		let answer: DoneAnswer;
		try {
			answer = await this.#o.processes.done(asked);
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
		await this.#follow(run, target, step, this.#o.processes.run(asked), false);
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
