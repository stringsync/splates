import {
	createEvalLoop,
	type EvalLoop,
	transitionEvalLoop,
} from "@evals/evals/loop";
import { z } from "zod";
import type { Storage } from "../storage";

/** Start, inspect and advance durable eval loops in a project’s shared storage. */
export class EvalLoopStore {
	constructor(private readonly storage: Storage) {}

	/** Every durable loop, for the read-only improvement catalog. */
	async list(): Promise<StoredEvalLoop[]> {
		const names = await this.storage.collection("eval-loops").list();
		return Promise.all(
			names
				.filter((name) => name.endsWith(".json"))
				.map((name) => this.show(name.slice(0, -5))),
		);
	}

	async start(id: string, input: unknown): Promise<StoredEvalLoop> {
		const start = loopStartSchema.parse(input);
		const loop = createEvalLoop(start.contract, start.revision);
		return this.document(id).update((saved) => {
			if (saved) {
				if (JSON.stringify(saved.start) !== JSON.stringify(start)) {
					throw new Error("Loop ID already used with different input");
				}
				return saved;
			}
			return {
				format: 1,
				id,
				version: 0,
				conversation: start.conversation,
				task: start.task,
				start,
				loop,
				history: [],
			};
		});
	}

	async show(id: string): Promise<StoredEvalLoop> {
		const saved = await this.document(id).read();
		if (!saved) {
			throw new Error(`No eval loop ${id}`);
		}
		return saved;
	}

	async at(id: string, version: number): Promise<StoredEvalLoop> {
		const saved = await this.show(id);
		if (
			!Number.isSafeInteger(version) ||
			version < 0 ||
			version > saved.version
		) {
			throw new Error("No such loop version");
		}
		let loop = createEvalLoop(saved.start.contract, saved.start.revision);
		const history = saved.history.slice(0, version);
		for (const entry of history) {
			loop = transitionEvalLoop(loop, entry.event);
		}
		return {
			...saved,
			version,
			loop,
			history,
			task:
				history.findLast((entry) => entry.task !== undefined)?.task ??
				saved.start.task,
		};
	}

	async change(id: string, input: LoopChange): Promise<StoredEvalLoop> {
		const change = {
			id: key.parse(input.id),
			expectedVersion: z
				.number()
				.int()
				.nonnegative()
				.parse(input.expectedVersion),
			event: loopEventSchema.parse(input.event),
			task: input.task === undefined ? undefined : text.parse(input.task),
		};
		return this.document(id).update((saved) => {
			if (!saved) {
				throw new Error(`No eval loop ${id}`);
			}
			const previous = saved.history.find((entry) => entry.id === change.id);
			if (previous) {
				if (JSON.stringify(previous) !== JSON.stringify(change)) {
					throw new Error("Event ID already used with different input");
				}
				return saved;
			}
			const event = change.event;
			// Completion retries with a new delivery ID are also harmless, even after later transitions.
			if (
				event.type === "finish-batch" &&
				saved.loop.batches.some(
					(entry) => entry.batch.id === event.completion.batch.id,
				)
			) {
				transitionEvalLoop(saved.loop, change.event);
				return saved;
			}
			if (saved.version !== change.expectedVersion) {
				throw new Error(
					`Stale loop version: expected ${change.expectedVersion}, current ${saved.version}; run splates evals show ${id}`,
				);
			}
			const loop = transitionEvalLoop(saved.loop, change.event);
			return {
				...saved,
				version: saved.version + 1,
				task: change.task ?? saved.task,
				loop,
				history: [...saved.history, change],
			};
		});
	}

	private document(id: string) {
		return this.storage.document<StoredEvalLoop>(
			`eval-loops/${key.parse(id)}.json`,
		);
	}
}

/** Commands are instructions only; recording a request never executes it. */
export function loopNext(saved: StoredEvalLoop): string {
	const prefix = `splates evals`;
	const flags = `${saved.id} <payload.json> --version ${saved.version} --event <stable-event-id>`;
	switch (saved.loop.stage.kind) {
		case "baseline-awaiting-run":
		case "awaiting-comparison":
			return `${prefix} request ${flags}; ask the person to start the paid run`;
		case "baseline-running":
		case "comparing":
			return `Wait for the person-started batch ${saved.loop.stage.batch.id}, then ${prefix} record ${flags}`;
		case "baseline-diagnosing":
			return `${prefix} diagnose ${flags}`;
		case "editing":
			return `Edit and commit the candidate in a code task, then ${prefix} propose ${flags} --task <task>`;
		case "deciding":
			return `${prefix} keep ${flags} or ${prefix} revert ${flags}; apply that decision in the linked code task`;
		case "complete":
			return "Loop complete: all repetitions passing";
		case "stopped":
			return `Loop stopped: ${saved.loop.stage.reason}`;
	}
}

const text = z.string().trim().min(1);
const key = text.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const contract = z
	.object({
		scenario: text,
		suiteRevision: text,
		target: z
			.object({
				model: text,
				agent: text.optional(),
				effort: text.optional(),
				variant: text.optional(),
			})
			.strict(),
		repetitions: z.number().int().positive(),
	})
	.strict();
const batch = z
	.object({
		id: key,
		contract,
		revision: text,
		baselineBatchId: key.optional(),
	})
	.strict();
const results = z.array(z.enum(["pass", "fail", "error"]));
export const loopStartSchema = z
	.object({
		contract,
		revision: text,
		conversation: text,
		task: text.optional(),
	})
	.strict();
export const loopEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("start-batch"), batch }).strict(),
	z
		.object({
			type: z.literal("finish-batch"),
			completion: z
				.object({ batch, results, baselineResults: results.optional() })
				.strict(),
		})
		.strict(),
	z
		.object({ type: z.literal("diagnose"), diagnosis: text, hypothesis: text })
		.strict(),
	z
		.object({ type: z.literal("candidate-ready"), revision: text, contract })
		.strict(),
	z
		.object({
			type: z.literal("decide"),
			action: z.enum(["keep", "revert"]),
			reason: text,
		})
		.strict(),
	z.object({ type: z.literal("rebaseline"), contract }).strict(),
	z.object({ type: z.literal("stop"), reason: text }).strict(),
]);
export type LoopStart = z.infer<typeof loopStartSchema>;
export interface LoopChange {
	id: string;
	expectedVersion: number;
	event: z.infer<typeof loopEventSchema>;
	task?: string;
}
export interface StoredEvalLoop {
	format: 1;
	id: string;
	version: number;
	conversation: string;
	task?: string;
	start: LoopStart;
	loop: EvalLoop;
	history: LoopChange[];
}
