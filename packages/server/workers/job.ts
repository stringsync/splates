import { z } from "zod";

/** The capability of a worker that runs heavy jobs on a `job` channel. */
export const JOBS = "jobs";

/** What a server opens a `job` channel with. */
export const JobParams = z.object({
	/** What the runner keeps its warm clone under: one per project. */
	project: z.string().min(1),
	/** The snapshot commit to check out. */
	commit: z.string().regex(/^[0-9a-f]{40,64}$/),
	/** The task the job is for, for the runner's log. */
	task: z.string().nullable().default(null),
	/** Run via `sh -c` in the checkout before the command; null runs none. */
	prepare: z.string().nullable().default(null),
	argv: z.array(z.string()).min(1),
	/** Set for the command, on top of the runner's own. */
	env: z.record(z.string(), z.string()).default({}),
	/**
	 * Names of files the command writes in the directory `SPLATES_JOB_FILES`
	 * names; each comes back once it exits, if it wrote it.
	 */
	files: z.array(z.string().regex(/^[\w.-]+$/)).default([]),
	/**
	 * How long the prepare step and the command may run together, in ms,
	 * before both are killed and the job exits 124; null for no limit.
	 */
	timeoutMs: z.number().positive().nullable().default(null),
});
export type JobParams = z.infer<typeof JobParams>;

/** What a runner says on a job's channel besides the command's output (its data frames). */
export const JobSaid = z.discriminatedUnion("type", [
	/** First: the tip of its warm clone for the project, null for none, for the server to bundle from. */
	z.object({ type: z.literal("have"), tip: z.string().nullable() }),
	/** The bundle was fetched and the checkout is being prepared. */
	z.object({ type: z.literal("preparing") }),
	/** The command started. */
	z.object({ type: z.literal("started") }),
	z.object({ type: z.literal("exit"), code: z.number() }),
	/** A returned file: this many data frame bytes follow, in order, then the next file's message. */
	z.object({ type: z.literal("file"), name: z.string(), size: z.number() }),
	/** Last on a job that ran: every file is sent. */
	z.object({ type: z.literal("done") }),
	z.object({ type: z.literal("failed"), reason: z.string() }),
]);
export type JobSaid = z.infer<typeof JobSaid>;

/** What a server says on a job's channel: the bundle's bytes are data frames, then this. */
export const JobTold = z.discriminatedUnion("type", [
	/** The whole bundle is sent (`bytes` long); none when the runner already holds the commit. */
	z.object({ type: z.literal("bundle"), bytes: z.number() }),
	z.object({ type: z.literal("cancel") }),
]);
export type JobTold = z.infer<typeof JobTold>;
