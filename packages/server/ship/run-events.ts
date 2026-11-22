import { z } from "zod";
import { BUMP } from "./wire";

/** A target as a run keeps it: what it was planned to do when it started. */
const RUN_TARGET = z.object({
	name: z.string(),
	command: z.string(),
	bump: BUMP.optional(),
	/** The exact version every step of it takes, resolved before it started. */
	version: z.string().optional(),
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

/** A supervised run's budget: how many fixes the server sends by itself. */
export const SUPERVISE = z.object({ budget: z.number().int().min(0) });
export type Supervise = z.infer<typeof SUPERVISE>;
const STEP = { target: z.string(), step: z.string() };

/**
 * One thing that happened in a ship's run, a line of its run file. The run
 * is these folded in order, so the file alone says where it stands.
 */
export const RUN_EVENT = z.discriminatedUnion("type", [
	/**
	 * The run began, with a `supervise` budget of fixes the server sends a
	 * failed step to an agent for by itself, when it was started supervised,
	 * on `commit` of the main tree, which every step runs on from its own
	 * checkout; a run from before there was one has none and runs in the
	 * main tree.
	 */
	z.object({
		type: z.literal("started"),
		...AT,
		targets: z.array(RUN_TARGET),
		supervise: SUPERVISE.optional(),
		/** Whether the server answers every confirm prompt Yes by itself. */
		autoApprove: z.boolean().optional(),
		commit: z.string().optional(),
	}),
	/** The user switched auto-approving of confirm prompts on or off. */
	z.object({ type: z.literal("auto-approval"), ...AT, on: z.boolean() }),
	/**
	 * The user switched supervision on, or gave it more fixes: `budget` is the
	 * run's whole budget from here, counting the fixes already spent.
	 */
	z.object({
		type: z.literal("supervised"),
		...AT,
		budget: z.number().int().min(0),
	}),
	/** The run's checkout took in the commit fix task `task` landed as, and stands on `commit`. */
	z.object({
		type: z.literal("advanced"),
		...AT,
		task: z.number(),
		commit: z.string(),
	}),
	/** The server came back to a run it had left unsettled. */
	z.object({ type: z.literal("resumed"), ...AT }),
	/** The user stopped the run: every step under way was cut short. */
	z.object({ type: z.literal("stopped"), ...AT }),
	/** The user stopped one target: its steps under way were cut short and the rest of the run carries on. */
	z.object({ type: z.literal("target-stopped"), ...AT, target: z.string() }),
	/** The step's `done` is being asked. */
	z.object({ type: z.literal("checking"), ...AT, ...STEP }),
	/**
	 * The step's `run` started as process `pid`, or was taken back after a
	 * restart. A `handle` says where a worker keeps it, so a restart can take
	 * it back; a run on this server's own has none.
	 */
	z.object({
		type: z.literal("running"),
		...AT,
		...STEP,
		pid: z.number(),
		handle: z.object({ worker: z.string(), channel: z.number() }).optional(),
	}),
	/**
	 * Every frame of the step's process up to `seq` is written down above, so a
	 * restart takes it back from past it.
	 */
	z.object({ type: z.literal("held"), ...STEP, seq: z.number() }),
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
		/** `auto` when the run's auto-approving answered it, the user otherwise. */
		by: z.literal("auto").optional(),
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
	/**
	 * The failed step went to an agent, as board task `task`: by the user's
	 * Send to agent, or by the supervisor, spending one of its fixes.
	 */
	z.object({
		type: z.literal("sent"),
		...AT,
		...STEP,
		task: z.number(),
		by: z.literal("supervisor").optional(),
	}),
	/** The user sent a target's recap, its flagged steps, to an agent as board task `task`. */
	z.object({
		type: z.literal("recapped"),
		...AT,
		target: z.string(),
		task: z.number(),
	}),
	/** The fix the step was sent for merged, or was removed without merging. */
	z.object({
		type: z.literal("fixed"),
		...AT,
		...STEP,
		task: z.number(),
		/** `abandoned`: the agent's turn ended and it never took the task. */
		outcome: z.enum(["merged", "removed", "abandoned"]),
		/** What the agent last said, kept for an abandoned fix. */
		note: z.string().optional(),
	}),
]);
export type RunEvent = z.infer<typeof RUN_EVENT>;
