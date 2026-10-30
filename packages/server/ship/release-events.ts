import { z } from "zod";

const base = { id: z.string(), name: z.string(), at: z.string() };

/** One line of the events file a ship command writes, as the Release reports it. */
export const EVENT = z.discriminatedUnion("type", [
	z.object({
		...base,
		type: z.literal("declared"),
		stage: z.string(),
		packages: z.array(z.string()).default([]),
		deadlineMs: z.number(),
	}),
	z.object({ ...base, type: z.literal("started") }),
	z.object({
		...base,
		type: z.literal("staged"),
		package: z.string(),
		version: z.string(),
		stageId: z.string(),
		url: z.string(),
	}),
	z.object({ ...base, type: z.literal("check"), passed: z.boolean() }),
	z.object({ ...base, type: z.literal("done") }),
	z.object({ ...base, type: z.literal("skipped") }),
	z.object({ ...base, type: z.literal("failed"), error: z.string() }),
]);
