import type { Resource } from "core/disposable";
import { Duration } from "core/time";
import { fail } from "../exit";
import type { ConversationDeps, ConversationHost } from "./host";

/** How long a burst of writes to the live folder settles before it is read. */
const SETTLE = Duration.ms(200);

/** The env variable `bin/evals run` writes a run's progress under. */
export const EVALS_LIVE_DIR = "EVALS_LIVE_DIR";

/**
 * One eval the conversation's agent ran or is running, as read from the
 * progress `bin/evals run` writes (`evals/packages/evals/live.ts`).
 */
export interface EvalRun {
	/** The progress file's name, unique in the conversation. */
	name: string;
	/** When it started, as ISO. */
	startedAt: string;
	eval: string;
	group: string | null;
	agent: string;
	/** Turns of history seeded before the run. */
	seeded: number;
	/** Live user turns the script plays, and the one under way. */
	turns: number;
	turn: number;
	checks: { id: string; about: string }[];
	/** The judge, as `jev:latest`; null for none. */
	judge: string | null;
	/** The short transcript so far. */
	lines: { who: "user" | "agent" | "tool"; text: string }[];
	usd: number | null;
	/** Whether the agent is still working, or which grading step is. */
	phase: "agent" | "checks" | "judge";
	/** The finished run's report, as `bin/evals run --json` prints it. */
	report: Record<string, unknown> | null;
	/** It ended without a report: found unfinished when splates read it after a restart. */
	stopped?: true;
	/** The run watches for a cancel file beside its progress, so the page can cancel it. */
	cancellable?: true;
	/** When the person asked to cancel it, as ISO; the run may not have ended yet. */
	cancelling?: string;
	/** When the run ended on a cancel, as ISO, with no report. */
	cancelled?: string;
}

/** Where the agent of conversation `id` writes its evals' progress. */
export function evalsDir(conversations: string, id: string): string {
	return `${conversations}/evals-live/${id}`;
}

/**
 * The file that cancels the run whose progress is `name`: its progress
 * file's path with `.cancel` for `.jsonl`, which `bin/evals run` watches for.
 */
export function cancelFileOf(dir: string, name: string): string {
	return `${dir}/${name.replace(/\.jsonl$/, "")}.cancel`;
}

/** What tells the agent the person cancelled `run`, as the directive its message begins with. */
export function cancelledOf(run: EvalRun): string {
	const named = run.group === null ? run.eval : `${run.group} ${run.eval}`;
	return `[SPLATES EVAL CANCELLED ${named}]\n\nThe user cancelled this eval from its card; it ends without a report.`;
}

/** Reads one progress file, or null before its run says what it is. */
export function evalRunOf(name: string, text: string): EvalRun | null {
	let run: EvalRun | null = null;
	for (const raw of text.split("\n")) {
		const event = parsed(raw);
		if (event === null) {
			continue;
		}
		if (event.type === "start") {
			run = startOf(name, event);
		} else if (run !== null) {
			apply(run, event);
		}
	}
	return run;
}

/**
 * The evals the conversation's agent runs, followed from the folder it
 * writes their progress to, kept on the conversation's state for its cards.
 */
export class ConversationEvals {
	private watching: Resource | null = null;
	private settling: Resource | null = null;
	/** When the person asked to cancel each run, by progress file name, until it ends. */
	private readonly cancelling = new Map<string, string>();

	constructor(
		private readonly host: ConversationHost,
		private readonly deps: ConversationDeps,
		/** Says `text` to the agent as the server. */
		private readonly say: (text: string) => Promise<void>,
	) {}

	private get dir(): string {
		return evalsDir(this.deps.dir, this.host.state.id);
	}

	/** Reads the runs already there, marking any left unfinished as stopped. */
	async load(): Promise<void> {
		if (!(await this.deps.fs.exists(this.dir))) {
			return;
		}
		const runs = await this.read();
		this.host.state.evals = runs.map((run) =>
			run.report === null && run.cancelled === undefined
				? { ...run, stopped: true }
				: run,
		);
		if (runs.length > 0) {
			this.host.changed();
		}
	}

	/**
	 * Cancels running eval `name` at the person's word: writes the file its
	 * run watches for, then tells the agent the person cancelled it.
	 */
	async cancel(name: string): Promise<void> {
		const run = this.host.state.evals?.find((each) => each.name === name);
		if (run === undefined) {
			fail("not_found", `no eval run ${name} in this conversation`, { name });
		}
		// Ended meanwhile: nothing left to cancel.
		if (
			run.report !== null ||
			run.stopped === true ||
			run.cancelled !== undefined ||
			this.cancelling.has(name)
		) {
			return;
		}
		if (run.cancellable !== true) {
			fail("usage", `eval run ${name} cannot be cancelled`, { name });
		}
		const at = new Date(this.deps.clock.now()).toISOString();
		await this.deps.fs.write(cancelFileOf(this.dir, name), `${at}\n`);
		this.cancelling.set(name, at);
		run.cancelling = at;
		this.host.changed();
		await this.say(cancelledOf(run));
	}

	/** Follows the folder from now on, while the agent runs. */
	async follow(): Promise<void> {
		if (this.watching !== null) {
			return;
		}
		await this.deps.fs.mkdir(this.dir);
		this.watching = this.deps.fs.watch(this.dir, () => this.soon());
	}

	dispose(): void {
		this.watching?.dispose();
		this.watching = null;
		this.settling?.dispose();
		this.settling = null;
	}

	private soon(): void {
		if (this.settling !== null) {
			return;
		}
		this.settling = this.deps.timer.setTimeout(() => {
			this.settling = null;
			void this.refresh().catch(() => {});
		}, SETTLE);
	}

	private async refresh(): Promise<void> {
		const runs = await this.read();
		for (const run of runs) {
			const at = this.cancelling.get(run.name);
			if (at === undefined) {
				continue;
			}
			if (run.report === null && run.cancelled === undefined) {
				run.cancelling = at;
			} else {
				this.cancelling.delete(run.name);
			}
		}
		this.host.state.evals = runs;
		this.host.changed();
	}

	private async read(): Promise<EvalRun[]> {
		const names = (await this.deps.fs.readdir(this.dir))
			.filter((name) => name.endsWith(".jsonl"))
			.sort();
		const runs: EvalRun[] = [];
		for (const name of names) {
			const text = await this.deps.fs
				.read(`${this.dir}/${name}`)
				.catch(() => "");
			const run = evalRunOf(name, text);
			if (run !== null) {
				runs.push(run);
			}
		}
		return runs;
	}
}

function parsed(raw: string): Record<string, unknown> | null {
	try {
		const event: unknown = JSON.parse(raw);
		return isRecord(event) ? event : null;
	} catch {
		return null;
	}
}

function startOf(name: string, event: Record<string, unknown>): EvalRun | null {
	if (
		typeof event.eval !== "string" ||
		typeof event.at !== "string" ||
		Number.isNaN(Date.parse(event.at))
	) {
		return null;
	}
	return {
		name,
		startedAt: event.at,
		eval: event.eval,
		group: typeof event.group === "string" ? event.group : null,
		agent: typeof event.agent === "string" ? event.agent : "",
		seeded: typeof event.seeded === "number" ? event.seeded : 0,
		turns: typeof event.turns === "number" ? event.turns : 1,
		turn: 1,
		checks: Array.isArray(event.checks)
			? event.checks.flatMap((check) =>
					isRecord(check) &&
					typeof check.id === "string" &&
					typeof check.about === "string"
						? [{ id: check.id, about: check.about }]
						: [],
				)
			: [],
		judge: typeof event.judge === "string" ? event.judge : null,
		lines: [],
		usd: null,
		phase: "agent",
		report: null,
		...(event.cancellable === true ? { cancellable: true as const } : {}),
	};
}

function apply(run: EvalRun, event: Record<string, unknown>): void {
	if (event.type === "line" && isRecord(event.line)) {
		const { who, text } = event.line;
		if (
			(who === "user" || who === "agent" || who === "tool") &&
			typeof text === "string"
		) {
			run.lines.push({ who, text });
		}
	} else if (event.type === "turn" && typeof event.turn === "number") {
		run.turn = event.turn;
	} else if (event.type === "usage" && typeof event.usd === "number") {
		run.usd = event.usd;
	} else if (
		event.type === "phase" &&
		(event.phase === "checks" || event.phase === "judge")
	) {
		run.phase = event.phase;
	} else if (event.type === "done" && isRecord(event.report)) {
		run.report = event.report;
	} else if (
		event.type === "cancelled" &&
		typeof event.at === "string" &&
		!Number.isNaN(Date.parse(event.at))
	) {
		run.cancelled = event.at;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
