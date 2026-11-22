import type { Resource } from "core/disposable";
import type { Logger } from "core/log";
import { Duration, type Timer } from "core/time";
import { fail } from "../exit";
import type { SignalBook } from "./book";
import {
	LONGEST_WAIT_MS,
	PROBE_FLOOR_MS,
	PROBE_RUN_MS,
	PROBE_RUNS_KEPT,
	PROBE_STREAM_CHARS,
	PROBE_STREAM_LINES,
	type ProbeStart,
	type ProbeState,
	type SignalProbe,
} from "./types";

const ON: readonly ProbeState[] = ["idle", "running"];

/** Whether `probe` still idles or runs. */
export function isOn(probe: SignalProbe): boolean {
	return ON.includes(probe.state);
}

/**
 * Checks signal sources while they have subscribers. Call arm after a restart,
 * start to register a check, and stop to remove its source and notify waiters.
 */
export class Probes {
	private readonly on = new Map<string, SignalProbe>();
	private readonly timers = new Map<
		string,
		{ next?: Resource; deadline?: Resource }
	>();
	/** Each signal's runs, one after another. */
	private readonly queue = new Map<string, Promise<void>>();

	constructor(private readonly deps: ProbeDeps) {}

	/** Takes back the probes still on, ending those whose deadline passed. */
	async arm(): Promise<void> {
		for (const probe of await this.deps.book.probes()) {
			if (!isOn(probe)) {
				continue;
			}
			this.on.set(probe.name, probe);
			if (Date.parse(probe.deadline) <= this.deps.now()) {
				await this.timeOut(probe.name);
				continue;
			}
			this.scheduleDeadline(probe);
			if (probe.state === "running") {
				this.scheduleNext(
					probe,
					probe.next === undefined
						? 0
						: Math.max(0, Date.parse(probe.next) - this.deps.now()),
				);
			}
		}
	}

	/**
	 * Starts a probe on `ask.name`, replacing any on it: the waits on the
	 * old source end as removed. With a wait already on the signal it runs at once.
	 */
	start(ask: ProbeAsk): Promise<SignalProbe> {
		return this.serially(ask.name, () => this.begin(ask));
	}

	private async begin(ask: ProbeAsk): Promise<SignalProbe> {
		if (!Number.isFinite(ask.everyMs) || ask.everyMs < PROBE_FLOOR_MS) {
			fail("usage", "a probe runs every 30s at the most often", {});
		}
		if (!Number.isFinite(ask.timeoutMs) || ask.timeoutMs < 1000) {
			fail("usage", "a probe needs a timeout of at least a second", {});
		}
		if (ask.timeoutMs > LONGEST_WAIT_MS) {
			fail("usage", "a probe may run 7 days at most", {});
		}
		if (ask.script.trim() === "") {
			fail("usage", "give the probe's script after --", {});
		}
		if (ask.description.trim() === "") {
			fail(
				"usage",
				"say what the probe checks with --description, in a short line",
				{},
			);
		}
		const old = this.on.get(ask.name);
		if (old !== undefined) {
			await this.end(old, "replaced");
		}
		const now = this.deps.now();
		const probe: SignalProbe = {
			name: ask.name,
			description: ask.description.trim(),
			script: ask.script,
			everyMs: ask.everyMs,
			cwd: ask.cwd,
			conversation: ask.conversation,
			...(ask.args === undefined ? {} : { args: ask.args }),
			state: "idle",
			startedAt: new Date(now).toISOString(),
			deadline: new Date(now + ask.timeoutMs).toISOString(),
			passed: null,
			subscribed: false,
			count: 0,
			runs: [],
		};
		this.on.set(probe.name, probe);
		await this.keep(probe);
		this.scheduleDeadline(probe);
		if ((await this.deps.subscriptions(probe.name)) > 0) {
			const running: SignalProbe = {
				...probe,
				state: "running",
				subscribed: true,
			};
			this.on.set(probe.name, running);
			await this.run(running, true, "wait");
		}
		return this.on.get(probe.name) ?? probe;
	}

	/**
	 * Something began to wait on `name`: its probe, if one is on, runs now, and
	 * raises if it passes, which the new wait takes. Resolves once that run is done.
	 */
	subscribed(name: string): Promise<void> {
		return this.serially(name, async () => {
			const probe = this.on.get(name);
			if (probe === undefined) {
				return;
			}
			const running: SignalProbe = {
				...probe,
				state: "running",
				subscribed: true,
			};
			this.on.set(name, running);
			await this.run(running, true, "wait");
		});
	}

	/** A subscription to `name` may have ended: its probe ends, orphaned, when none is left. */
	unsubscribed(name: string): Promise<void> {
		return this.serially(name, async () => {
			const probe = this.on.get(name);
			if (
				probe?.subscribed === true &&
				(await this.deps.subscriptions(name)) === 0
			) {
				await this.end(probe, "orphaned");
			}
		});
	}

	/**
	 * The person polls `name` now, busy machine or not: the run counts as any
	 * poll, raises if it passes (passed before or not), and restarts the
	 * interval. Resolves with the probe once the run is done.
	 */
	pollNow(name: string): Promise<SignalProbe> {
		return this.serially(name, async () => {
			const probe = this.on.get(name);
			if (probe === undefined) {
				fail("not_found", `no poll script running on '${name}'`, { name });
			}
			await this.run(probe, true, "poll now");
			const ran = this.on.get(name);
			if (ran !== undefined) {
				return ran;
			}
			return (await this.deps.book.probe(name)) ?? probe;
		});
	}

	/** The person stops the probe on `name`; its waits end as removed. */
	stop(name: string): Promise<void> {
		return this.serially(name, async () => {
			const probe = this.on.get(name);
			if (probe === undefined) {
				fail("not_found", `no probe on '${name}'`, { name });
			}
			await this.end(probe, "stopped");
		});
	}

	dispose(): void {
		for (const { next, deadline } of this.timers.values()) {
			next?.dispose();
			deadline?.dispose();
		}
		this.timers.clear();
	}

	private serially<T>(name: string, work: () => Promise<T>): Promise<T> {
		const after = (this.queue.get(name) ?? Promise.resolve()).then(work);
		const settled = after.then(
			() => {},
			() => {},
		);
		this.queue.set(name, settled);
		void settled.then(() => {
			if (this.queue.get(name) === settled) {
				this.queue.delete(name);
			}
		});
		return after;
	}

	/** A scheduled run: first checks a subscription is left and the machine is free. */
	private scheduled(name: string): Promise<void> {
		return this.serially(name, async () => {
			const probe = this.on.get(name);
			if (probe === undefined || probe.state !== "running") {
				return;
			}
			if ((await this.deps.subscriptions(name)) === 0) {
				await this.end(probe, "orphaned");
				return;
			}
			if (await this.deps.busy().catch(() => false)) {
				this.deps.log.info(`probe ${name}: machine busy, run skipped`);
				this.scheduleNext(probe, probe.everyMs);
				await this.keep(this.on.get(name) ?? probe);
				return;
			}
			await this.run(probe, false, "scheduled");
		});
	}

	/** Runs `probe`'s script once; `fresh` for a wait's first run or a poll the person asked for, which raises on any pass. */
	private async run(
		probe: SignalProbe,
		fresh: boolean,
		startedBy: ProbeStart,
	): Promise<void> {
		this.timers.get(probe.name)?.next?.dispose();
		const started = this.deps.now();
		const at = new Date(started).toISOString();
		let exitCode: number;
		let stdout = "";
		let stderr = "";
		try {
			({ exitCode, stdout, stderr } = await this.deps.shell(
				withArgs(probe),
				probe.cwd,
				PROBE_RUN_MS,
			));
		} catch (error) {
			exitCode = 127;
			stderr = String(error);
		}
		const passed = exitCode === 0;
		const raising = passed && (fresh || probe.passed !== true);
		const ran: SignalProbe = {
			...probe,
			passed,
			count: probe.count + 1,
			runs: [
				...probe.runs,
				{
					at,
					exit: exitCode,
					output: tail(stdout, stderr),
					ms: Math.max(0, this.deps.now() - started),
					startedBy,
					fired: raising,
					stdout: streamTail(stdout),
					stderr: streamTail(stderr),
				},
			].slice(-PROBE_RUNS_KEPT),
		};
		this.on.set(probe.name, ran);
		if (raising) {
			await this.deps.raise(
				probe.name,
				`probe ${probe.name}`,
				payloadOf(stdout, at),
			);
			if ((await this.deps.subscriptions(probe.name)) === 0) {
				await this.end(ran, "raised");
				return;
			}
		}
		this.scheduleNext(ran, ran.everyMs);
		await this.keep(this.on.get(probe.name) ?? ran);
	}

	private scheduleNext(probe: SignalProbe, inMs: number): void {
		const timers = this.timers.get(probe.name) ?? {};
		timers.next?.dispose();
		timers.next = this.deps.timer.setTimeout(() => {
			void this.scheduled(probe.name).catch((error: unknown) =>
				this.deps.log.error(`probe ${probe.name}: ${String(error)}`),
			);
		}, Duration.ms(inMs));
		this.timers.set(probe.name, timers);
		const live = this.on.get(probe.name);
		if (live !== undefined) {
			this.on.set(probe.name, {
				...live,
				next: new Date(this.deps.now() + inMs).toISOString(),
			});
		}
	}

	private scheduleDeadline(probe: SignalProbe): void {
		const timers = this.timers.get(probe.name) ?? {};
		timers.deadline?.dispose();
		const left = Math.max(0, Date.parse(probe.deadline) - this.deps.now());
		const startedAt = probe.startedAt;
		timers.deadline = this.deps.timer.setTimeout(() => {
			if (this.on.get(probe.name)?.startedAt !== startedAt) {
				return;
			}
			void this.serially(probe.name, () => this.timeOut(probe.name)).catch(
				(error: unknown) =>
					this.deps.log.error(`probe ${probe.name}: ${String(error)}`),
			);
		}, Duration.ms(left));
		this.timers.set(probe.name, timers);
	}

	private async timeOut(name: string): Promise<void> {
		const probe = this.on.get(name);
		if (probe === undefined) {
			return;
		}
		await this.end(probe, "timed out");
	}

	private async end(
		probe: SignalProbe,
		state: Exclude<ProbeState, "idle" | "running">,
	): Promise<void> {
		const timers = this.timers.get(probe.name);
		timers?.next?.dispose();
		timers?.deadline?.dispose();
		this.timers.delete(probe.name);
		this.on.delete(probe.name);
		const { next: _next, ...rest } = probe;
		await this.keep({
			...rest,
			state,
			endedAt: new Date(this.deps.now()).toISOString(),
		});
		if (state === "stopped" || state === "replaced" || state === "timed out") {
			await this.deps.remove(probe.name, `probe ${state}`);
		}
	}

	private async keep(probe: SignalProbe): Promise<void> {
		await this.deps.book.keepProbe(probe);
		await this.deps
			.show(probe)
			.catch((error: unknown) =>
				this.deps.log.error(`probe ${probe.name}: ${String(error)}`),
			);
	}
}

/** What a raise by a probe carries: its stdout, as JSON when it parses, and when it was checked. */
export function payloadOf(stdout: string, checkedAt: string): unknown {
	const text = stdout.trim();
	if (text === "") {
		return { checkedAt };
	}
	try {
		const parsed: unknown = JSON.parse(text);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed)
		) {
			return { ...parsed, checkedAt };
		}
		return { output: parsed, checkedAt };
	} catch {
		return { output: text, checkedAt };
	}
}

/** The last lines a run printed, for its card. */
function tail(stdout: string, stderr: string): string {
	const lines = [stdout.trim(), stderr.trim()]
		.filter((each) => each !== "")
		.join("\n")
		.split("\n");
	return lines.slice(-10).join("\n").slice(-2000);
}

/** The last of one stream a run printed, for its row in the poll history. */
function streamTail(text: string): string {
	return text
		.trim()
		.split("\n")
		.slice(-PROBE_STREAM_LINES)
		.join("\n")
		.slice(-PROBE_STREAM_CHARS);
}

/** The probe's script, with its call's arguments in `$SPLATES_ARGS`. */
function withArgs(probe: SignalProbe): string {
	if (probe.args === undefined) {
		return probe.script;
	}
	const quoted = `'${probe.args.replaceAll("'", "'\\''")}'`;
	return `SPLATES_ARGS=${quoted}; export SPLATES_ARGS; ${probe.script}`;
}

/** What `splates signal probe` asks for. */
export interface ProbeAsk {
	name: string;
	description: string;
	script: string;
	everyMs: number;
	timeoutMs: number;
	/** Its project's main tree, where the script runs. */
	cwd: string;
	/** The conversation that starts it, which shows its card. */
	conversation: string;
	/** The call's arguments as JSON, for `$SPLATES_ARGS`. */
	args?: string;
}

/** What a probe's runner works with. */
export interface ProbeDeps {
	book: SignalBook;
	/** Runs `script` with `sh -c` in `cwd`, killed after `timeoutMs`. */
	shell(
		script: string,
		cwd: string,
		timeoutMs: number,
	): Promise<{ exitCode: number; stdout: string; stderr: string }>;
	/** Whether the machine is too busy for a scheduled run, as `splates machine` says. */
	busy(): Promise<boolean>;
	/** Raises `name` as `by`, waking every wait on it. */
	raise(name: string, by: string, payload: unknown): Promise<void>;
	/**
	 * How many subscriptions `name` has now: waits still waiting, and anything
	 * else that listens for it, as an automation.
	 */
	subscriptions(name: string): Promise<number>;
	/** Ends waits when their probe source disappears. */
	remove(name: string, reason: string): Promise<void>;
	/** Shows `probe` on its card in the conversation that started it. */
	show(probe: SignalProbe): Promise<void>;
	now(): number;
	timer: Timer;
	log: Logger;
}
