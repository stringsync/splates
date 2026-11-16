import type { Resource } from "core/disposable";
import type { Fs } from "core/system";
import { Duration, SystemTimer } from "core/time";
import { EVENT } from "./release-events";
import type { StageLog } from "./stages";

/**
 * The steps a project's own Release declares, as its ship command reports
 * them in the file named by SPLATES_SHIP_EVENTS. Called release steps here so
 * they are not taken for a ship's per-project steps or their stages.
 */
export type ReleaseStepState =
	| "pending"
	| "running"
	| "asking"
	| "done"
	| "skipped"
	| "failed";

/** One step of a project's Release, folded from its events. */
export interface ReleaseStep {
	id: string;
	name: string;
	/** The Release's own grouping: preflight, stamp, build, publish, tag, notes. */
	stage: string;
	packages: string[];
	state: ReleaseStepState;
	started: string | null;
	ended: string | null;
	/** How long it may take, in milliseconds, from the Release. */
	deadlineMs: number;
	/** Whether its last check passed, or null before any. */
	checked: boolean | null;
	/** What its last check still waits on, such as a publish workflow run's `in_progress`. */
	status: string | null;
	/** Where to look into it, such as the publish workflow run on GitHub. */
	url: string | null;
	error: string | null;
	/** Packages this step staged on npm, which wait for the person to approve them. */
	staged: StagedPackage[];
	question?: {
		questionId: string;
		question: string;
		link?: string;
		code?: string;
	} | null;
	/** What the step asks a task to adopt, while it waits on the task. */
	adopt?: {
		versions: Record<string, string>;
		unmovable: { name: string; file: string; pin: string }[];
	} | null;
	/** Its slice of the ship's log, from when it started to when it ended; absent before it starts. */
	log?: StageLog;
}

/**
 * The release steps in an events file's `text`, in the order the Release
 * declared them. Give it the whole file, even half written.
 */
export function readReleaseSteps(text: string): ReleaseStep[] {
	const steps = new Map<string, ReleaseStep>();
	for (const line of text.split("\n")) {
		let json: unknown;
		try {
			json = JSON.parse(line);
		} catch {
			continue;
		}
		const parsed = EVENT.safeParse(json);
		if (!parsed.success) {
			continue;
		}
		const event = parsed.data;
		if (event.type === "declared") {
			steps.set(event.id, {
				id: event.id,
				name: event.name,
				stage: event.stage,
				packages: event.packages,
				state: "pending",
				started: null,
				ended: null,
				deadlineMs: event.deadlineMs,
				checked: null,
				status: null,
				url: null,
				error: null,
				staged: [],
			});
			continue;
		}
		const step = steps.get(event.id);
		if (step === undefined) {
			continue;
		}
		switch (event.type) {
			case "ask":
				steps.set(event.id, {
					...step,
					state: "asking",
					question: {
						questionId: event.questionId,
						question: event.question,
						link: event.link,
						code: event.code,
					},
				});
				break;
			case "adopt":
				steps.set(event.id, {
					...step,
					state: "asking",
					question: {
						questionId: event.questionId,
						question: "Adopt the upstream versions in a task",
					},
					adopt: { versions: event.versions, unmovable: event.unmovable },
				});
				break;
			case "answered":
				if (step.question?.questionId === event.questionId) {
					steps.set(event.id, {
						...step,
						state: "running",
						question: null,
						adopt: null,
					});
				}
				break;
			case "started":
				steps.set(event.id, {
					...step,
					state: "running",
					started: event.at,
					ended: null,
					error: null,
				});
				break;
			case "staged":
				steps.set(event.id, {
					...step,
					staged: [
						...step.staged.filter(
							(each) =>
								each.package !== event.package ||
								each.version !== event.version,
						),
						{
							package: event.package,
							version: event.version,
							stageId: event.stageId,
							url: event.url,
						},
					],
				});
				break;
			case "check":
				steps.set(event.id, {
					...step,
					checked: event.passed,
					status: event.status ?? null,
					url: event.url ?? step.url,
				});
				break;
			case "done":
				steps.set(event.id, { ...step, state: "done", ended: event.at });
				break;
			case "skipped":
				steps.set(event.id, { ...step, state: "skipped", ended: event.at });
				break;
			case "failed":
				steps.set(event.id, {
					...step,
					state: "failed",
					ended: event.at,
					error: event.error,
				});
				break;
		}
	}
	return [...steps.values()];
}

/** A piece of a ship's output: when it reached the log, and where the log ended after it. */
export interface OutputMark {
	at: number;
	to: number;
}

/**
 * `steps`, each with its slice of the ship's log: from where the log ended
 * before the step started to where it ended once the step ended, as `marks`
 * say when each piece of output came. A Release records a step's start before
 * running it, so what came after belongs to it. `from` is where the ship's
 * output began; a step whose closed slice `kept` holds keeps it, as one a
 * restarted server has no marks for.
 */
export function withLogs(
	steps: ReleaseStep[],
	marks: readonly OutputMark[],
	from: number,
	kept: ReadonlyMap<string, StageLog> = new Map(),
): ReleaseStep[] {
	const offset = (ms: number, inclusive: boolean): number => {
		let to = from;
		for (const mark of marks) {
			if (inclusive ? mark.at > ms : mark.at >= ms) {
				break;
			}
			to = mark.to;
		}
		return to;
	};
	return steps.map((step) => {
		const closed = kept.get(step.id);
		if (closed !== undefined && closed.to !== null) {
			return { ...step, log: closed };
		}
		if (step.started === null) {
			return step;
		}
		return {
			...step,
			log: {
				from: offset(Date.parse(step.started), false),
				to: step.ended === null ? null : offset(Date.parse(step.ended), true),
			},
		};
	});
}

/** Why a ship command failed, naming the release step that did, or null when none did. */
export function releaseFailure(steps: ReleaseStep[]): string | null {
	const failed = steps.find((step) => step.state === "failed");
	return failed === undefined
		? null
		: `release step "${failed.name}" failed: ${failed.error ?? "no reason given"}`;
}

/** An events file's text for `lines`, as a fake ship command writes it. */
export function eventsText(lines: Record<string, unknown>[]): string {
	return lines
		.map((line) => `${JSON.stringify({ schema: 1, ...line })}\n`)
		.join("");
}

/**
 * Follows an events file as its ship command grows it, handing `sink`
 * the steps so far each time they change, and once more on {@link flush}. A
 * command that writes nothing gives it nothing.
 */
/** Where followed release steps are kept. */
export interface ReleaseStepsSink {
	keep(steps: ReleaseStep[]): Promise<void>;
}

export class ReleaseStepsFollower implements Resource {
	private readonly timer;
	private last = "";
	private reading: Promise<void> = Promise.resolve();

	constructor(
		private readonly fs: Fs,
		private readonly path: string,
		private readonly sink: ReleaseStepsSink,
	) {
		this.timer = new SystemTimer().setInterval(() => {
			this.reading = this.reading.then(() => this.read());
		}, Duration.ms(500));
	}

	dispose(): void {
		this.timer.dispose();
	}

	/** Reads the file a last time, once the command has ended. */
	async flush(): Promise<void> {
		this.dispose();
		await this.reading;
		await this.read();
	}

	private async read(): Promise<void> {
		try {
			const text = await this.fs.read(this.path).catch(() => "");
			if (text === this.last) {
				return;
			}
			this.last = text;
			const steps = readReleaseSteps(text);
			if (steps.length > 0) {
				await this.sink.keep(steps);
			}
		} catch {
			// The page shows what it has; the ship goes on.
		}
	}
}

/** A package the Release staged on npm, held until the person approves it. */
export interface StagedPackage {
	package: string;
	version: string;
	/** What `npm stage approve` takes. */
	stageId: string;
	/** The npm page to approve it on. */
	url: string;
}
