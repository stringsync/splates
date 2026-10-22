import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { z } from "zod";
import { Git } from "../git";
import { refuse } from "../server/shared";
import { JobParams } from "./job";
import type { JobPool } from "./job-pool";
import { JobSnapshot } from "./job-snapshot";
import type { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";
import { RunnerLost } from "./remote-job";

/** What `POST /api/jobs` is sent. */
export const JobRequest = z.object({
	/** The worktree to run the job against, as it stands. */
	worktree: z.string().min(1),
	/** The main tree of its project, which a runner keeps its warm clone by. */
	project: z.string().min(1),
	task: z.string().nullable().default(null),
	prepare: JobParams.shape.prepare,
	argv: JobParams.shape.argv,
	env: JobParams.shape.env,
	files: JobParams.shape.files,
	/** Waits ahead of ordinary jobs in the pool's queue: a merge's gate, which others wait on. */
	first: z.boolean().default(false),
	/** Runs this commit of the project, which its worktree holds, instead of a snapshot of the worktree. */
	commit: JobParams.shape.commit.optional(),
});
export type JobRequest = z.infer<typeof JobRequest>;

/** What `POST /api/jobs` streams back, one JSON object a line. */
export const JobEvent = z.discriminatedUnion("type", [
	/** The command's output so far, base64. */
	z.object({ type: z.literal("out"), data: z.string() }),
	/** A file the job returned, base64. */
	z.object({ type: z.literal("file"), name: z.string(), data: z.string() }),
	z.object({ type: z.literal("exit"), code: z.number() }),
	/** The job waits for a place on a runner, at this position in the pool's queue, from 1. */
	z.object({ type: z.literal("queued"), position: z.number() }),
	/** No runner is to be had for the job: the caller runs it here. */
	z.object({ type: z.literal("local") }),
	z.object({ type: z.literal("error"), reason: z.string() }),
]);
export type JobEvent = z.infer<typeof JobEvent>;

/**
 * Runs heavy jobs on the runners that have joined: `POST /api/jobs` snapshots
 * the worktree, waits for a place in the pool's queue, and streams the job's
 * output and result back until it ends. A caller that hangs up ends the job
 * on the runner. A job whose runner is lost is run again on another, once,
 * and then by its caller, here.
 */
export class RunnerJobs {
	private readonly snapshot: JobSnapshot;
	private jobs = 0;

	constructor(
		private readonly registry: WorkerRegistry,
		readonly pool: JobPool,
		ps: Ps,
		private readonly log: Logger,
	) {
		this.snapshot = new JobSnapshot(new Git("/", { ps }));
	}

	readonly run = async (request: Request): Promise<Response> => {
		const body = JobRequest.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return refuse(400, "usage", "send the worktree, project and command");
		}
		const job = body.data;
		const abort = new AbortController();
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				const send = (event: JobEvent) => {
					if (!abort.signal.aborted) {
						controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
					}
				};
				void this.execute(job, abort.signal, send)
					.catch((error: unknown) => {
						if (!abort.signal.aborted) {
							send({
								type: "error",
								reason: error instanceof Error ? error.message : String(error),
							});
						}
					})
					.finally(() => {
						if (!abort.signal.aborted) {
							controller.close();
						}
					});
			},
			cancel: () => abort.abort(),
		});
		return new Response(stream, {
			headers: { "content-type": "application/x-ndjson" },
		});
	};

	/** Runs `job` where the pool places it, again on another runner once if its runner is lost. */
	private async execute(
		job: JobRequest,
		signal: AbortSignal,
		send: (event: JobEvent) => void,
	): Promise<void> {
		const id = `job-${++this.jobs}`;
		const lost: string[] = [];
		for (;;) {
			const taking = this.pool.take(
				{
					id,
					project: job.project,
					task: job.task,
					what: job.argv.join(" ").slice(0, 120),
					avoid: lost,
					...(job.first ? { first: true } : {}),
				},
				signal,
			);
			const at = this.pool.queue().find((each) => each.id === id);
			if (at !== undefined) {
				send({ type: "queued", position: at.position });
			}
			const place = await taking;
			try {
				const runner =
					place.runner === null
						? undefined
						: this.registry.worker(place.runner);
				if (runner === undefined) {
					send({ type: "local" });
					return;
				}
				try {
					await this.runOn(runner, job, signal, send);
					return;
				} catch (error) {
					if (signal.aborted) {
						return;
					}
					if (!(error instanceof RunnerLost || !runner.connected)) {
						throw error;
					}
					this.log.info(`a job lost its runner ${runner.id}: ${String(error)}`);
					// Once more on another runner, then here.
					if (lost.length > 0) {
						send({ type: "local" });
						return;
					}
					lost.push(runner.id);
				}
			} finally {
				place.dispose();
			}
		}
	}

	private async runOn(
		runner: RemoteWorker,
		job: JobRequest,
		signal: AbortSignal,
		send: (event: JobEvent) => void,
	): Promise<void> {
		const commit = job.commit ?? (await this.snapshot.take(job.worktree));
		const result = await runner.job(
			{
				project: job.project,
				commit,
				task: job.task,
				prepare: job.prepare,
				argv: job.argv,
				env: job.env,
				files: job.files,
			},
			{
				bundle: (tip) => this.snapshot.bundle(job.worktree, commit, tip),
				output: (bytes) =>
					send({ type: "out", data: Buffer.from(bytes).toString("base64") }),
				signal,
			},
		);
		for (const [name, bytes] of result.files) {
			send({
				type: "file",
				name,
				data: Buffer.from(bytes).toString("base64"),
			});
		}
		send({ type: "exit", code: result.code });
	}
}
