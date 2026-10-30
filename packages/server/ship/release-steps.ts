import type { Resource } from "webappwiz/disposable";
import type { Fs } from "webappwiz/system";
import { Duration, SystemTimer } from "webappwiz/time";
import { z } from "zod";

/**
 * The steps a project's own Release declares, as its ship command reports
 * them in the file named by SPLATES_SHIP_EVENTS. Called release steps here so
 * they are not taken for a ship's per-project steps or their stages.
 */
export type ReleaseStepState =
	| "pending"
	| "running"
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
	error: string | null;
}

const base = { id: z.string(), name: z.string(), at: z.string() };

const EVENT = z.discriminatedUnion("type", [
	z.object({
		...base,
		type: z.literal("declared"),
		stage: z.string(),
		packages: z.array(z.string()).default([]),
		deadlineMs: z.number(),
	}),
	z.object({ ...base, type: z.literal("started") }),
	z.object({ ...base, type: z.literal("check"), passed: z.boolean() }),
	z.object({ ...base, type: z.literal("done") }),
	z.object({ ...base, type: z.literal("skipped") }),
	z.object({ ...base, type: z.literal("failed"), error: z.string() }),
]);

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
				error: null,
			});
			continue;
		}
		const step = steps.get(event.id);
		if (step === undefined) {
			continue;
		}
		switch (event.type) {
			case "started":
				steps.set(event.id, {
					...step,
					state: "running",
					started: event.at,
					ended: null,
					error: null,
				});
				break;
			case "check":
				steps.set(event.id, { ...step, checked: event.passed });
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
