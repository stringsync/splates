import { z } from "zod";

/** The steps a job `splates run` sends to a runner of its own goes through, in order. */
export const DIRECT_PHASES = [
	"placing",
	"making",
	"booting",
	"waiting",
	"sending",
	"preparing",
	"running",
	"done",
	"failed",
] as const;

/** A step of a job on a runner `splates run` made. */
export type DirectPhase = (typeof DIRECT_PHASES)[number];

/** A runner `splates run` made, as it last saw it. */
export const DirectRunnerReport = z.object({
	id: z.string(),
	type: z.string(),
	cpus: z.number().nullable(),
	memory: z.number().nullable(),
	dollarsPerHour: z.number().nullable(),
	address: z.string().nullable(),
	/** `booting`, `up`, or `deleted`. */
	state: z.enum(["booting", "up", "deleted"]),
	/** When it was made, epoch ms. */
	createdAt: z.number(),
});
export type DirectRunnerReport = z.infer<typeof DirectRunnerReport>;

/** Where a job of `splates run` on a runner of its own stands. */
export const DirectJobReport = z.object({
	id: z.string(),
	/** The runner it is on or waits for; null before it has one. */
	runner: z.string().nullable(),
	/** The project's main tree's git dir. */
	project: z.string(),
	task: z.string().nullable(),
	/** What it runs, shortened. */
	what: z.string(),
	phase: z.enum(DIRECT_PHASES),
	/** Its exit code once done; null before. */
	code: z.number().nullable(),
	/** Why it failed, once failed; null otherwise. */
	reason: z.string().nullable(),
	/** When it started, epoch ms. */
	since: z.number(),
});
export type DirectJobReport = z.infer<typeof DirectJobReport>;
