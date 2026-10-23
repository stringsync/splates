import { z } from "zod";
import { WORKER_LIMITS } from "./limits";

// What the worker budget keeps in its document, read back and checked.

export const Life = z.object({
	/** The worker's id. */
	id: z.string(),
	type: z.string(),
	/** Its provider's list price, which every figure here is an estimate from. */
	dollarsPerHour: z.number(),
	/** When it was made, epoch ms. */
	from: z.number(),
	/** When it was destroyed, epoch ms; null while it runs. */
	until: z.number().nullable(),
	/** Whether it is a stretch the worker was stopped and kept, `dollarsPerHour` its storage alone. */
	stopped: z.boolean().default(false),
});

export type Life = z.infer<typeof Life>;

const Held = z.object({
	/** The root of the project it is in. */
	project: z.string(),
	conversation: z.string(),
});

/** A conversation a hard stop checkpointed, to carry on once the budget allows. */
export type BudgetHeld = z.infer<typeof Held>;

const Raise = z.object({
	id: z.number().int(),
	limit: z.enum(WORKER_LIMITS),
	dollars: z.number(),
	from: z.number(),
	until: z.number(),
});

/** Dollars added to one limit for a while. */
export type WorkerRaise = z.infer<typeof Raise>;

export const Kept = z.object({
	/** Whether the user has chosen the limits, rather than left the defaults unseen. */
	reviewed: z.boolean().default(false),
	/** The limits set over the defaults. */
	limits: z
		.object({
			hour: z.number().optional(),
			day: z.number().optional(),
			month: z.number().optional(),
		})
		.default({}),
	/** The most runners up at once in the account, over the default. */
	runners: z.number().int().min(0).optional(),
	/** How long a runner runs after its last job, in seconds, over the default. */
	idle: z.number().int().min(1).optional(),
	/** How many stopped runners the server keeps, over the default. */
	keptStopped: z.number().int().min(0).optional(),
	raises: z.array(Raise).default([]),
	/** Each made worker's life, the ledger spend is counted from. */
	lives: z.array(Life).default([]),
	/** The conversations a hard stop checkpointed, until the budget allows again. */
	held: z.array(Held).default([]),
	/** The highest tier already alerted of each limit, by the window it was in. */
	alerted: z
		.array(
			z.object({
				limit: z.enum(WORKER_LIMITS),
				since: z.number(),
				tier: z.number(),
			}),
		)
		.default([]),
});

/** What the worker budget keeps in its document. */
export type WorkerBudgetFile = z.infer<typeof Kept>;
export type KeptFile = WorkerBudgetFile;
