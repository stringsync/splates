import { z } from "zod";
import { BUMP } from "./wire";

/** A target as a run keeps it: what it was planned to do when it started. */
const RUN_TARGET = z.object({
	name: z.string(),
	command: z.string(),
	bump: BUMP.optional(),
	dependencies: z.array(z.string()),
	steps: z.array(
		z.object({
			id: z.string(),
			does: z.string(),
			dependencies: z.array(z.string()).optional(),
		}),
	),
});
export type RunTarget = z.infer<typeof RUN_TARGET>;

/** What a step asks the user, as its `run` wrote it. */
export const PROMPT = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("confirm"), question: z.string() }),
	z.object({
		kind: z.literal("link"),
		url: z.string(),
		code: z.string().optional(),
	}),
	z.object({ kind: z.literal("ask"), question: z.string() }),
]);
export type Prompt = z.infer<typeof PROMPT>;

const AT = { at: z.number() };
const STEP = { target: z.string(), step: z.string() };

/**
 * One thing that happened in a ship's run, a line of its run file. The run
 * is these folded in order, so the file alone says where it stands.
 */
export const RUN_EVENT = z.discriminatedUnion("type", [
	z.object({ type: z.literal("started"), ...AT, targets: z.array(RUN_TARGET) }),
	/** The server came back to a run it had left unsettled. */
	z.object({ type: z.literal("resumed"), ...AT }),
	/** The user stopped the run: every step under way was cut short. */
	z.object({ type: z.literal("stopped"), ...AT }),
	/** The step's `done` is being asked. */
	z.object({ type: z.literal("checking"), ...AT, ...STEP }),
	/** The step's `run` started as process `pid`. */
	z.object({ type: z.literal("running"), ...AT, ...STEP, pid: z.number() }),
	z.object({ type: z.literal("output"), ...STEP, text: z.string() }),
	z.object({ type: z.literal("update"), ...STEP, line: z.string() }),
	z.object({
		type: z.literal("prompt"),
		...AT,
		...STEP,
		id: z.string(),
		prompt: PROMPT,
	}),
	z.object({
		type: z.literal("answered"),
		...AT,
		...STEP,
		id: z.string(),
		value: z.unknown(),
	}),
	z.object({ type: z.literal("withdrawn"), ...STEP, id: z.string() }),
	/** What the step's target released, passed to its dependents as `--upstream`. */
	z.object({ type: z.literal("released"), ...STEP, version: z.string() }),
	z.object({
		type: z.literal("ended"),
		...AT,
		...STEP,
		outcome: z.enum(["done", "skipped", "failed"]),
		error: z.string().optional(),
	}),
	/**
	 * A failed step sent round again: by the user's press, by its fix
	 * merging, or by the agent fixing it; the user's when unsaid.
	 */
	z.object({
		type: z.literal("retried"),
		...AT,
		...STEP,
		by: z.enum(["user", "fix", "agent"]).optional(),
		/** The started task of the agent that retried it, when it did. */
		task: z.string().optional(),
	}),
	/**
	 * What an agent added to the run: `text`, from started task `task`, about
	 * a step when `target` and `step` are given, with a `link` when it has one.
	 */
	z.object({
		type: z.literal("noted"),
		...AT,
		task: z.string(),
		text: z.string(),
		target: z.string().optional(),
		step: z.string().optional(),
		link: z.string().optional(),
	}),
	/** The failed step went to an agent, as board task `task`. */
	z.object({ type: z.literal("sent"), ...AT, ...STEP, task: z.number() }),
	/** The fix the step was sent for merged, or was removed without merging. */
	z.object({
		type: z.literal("fixed"),
		...AT,
		...STEP,
		task: z.number(),
		outcome: z.enum(["merged", "removed"]),
	}),
]);
export type RunEvent = z.infer<typeof RUN_EVENT>;
