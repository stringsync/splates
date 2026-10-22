import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { z } from "zod";
import { Git } from "../git";
import { refuse } from "../server/shared";
import { JobParams } from "./job";
import { JobSnapshot } from "./job-snapshot";
import type { WorkerRecords } from "./records";
import type { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";

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
});
export type JobRequest = z.infer<typeof JobRequest>;

/** What `POST /api/jobs` streams back, one JSON object a line. */
export const JobEvent = z.discriminatedUnion("type", [
	/** The command's output so far, base64. */
	z.object({ type: z.literal("out"), data: z.string() }),
	/** A file the job returned, base64. */
	z.object({ type: z.literal("file"), name: z.string(), data: z.string() }),
	z.object({ type: z.literal("exit"), code: z.number() }),
	z.object({ type: z.literal("error"), reason: z.string() }),
]);
export type JobEvent = z.infer<typeof JobEvent>;

/** The reason a request is refused for want of a runner, which a caller answers by running the job itself. */
export const NO_RUNNER = "no_runner";

/**
 * Runs heavy jobs on the runners that have joined: `POST /api/jobs` snapshots
 * the worktree, picks a runner, and streams the job's output and result back
 * until it ends. A caller that hangs up ends the job on the runner.
 */
export class RunnerJobs {
	/** Jobs on each runner now, so the next goes to the idlest. */
	private readonly running = new Map<string, number>();
	private readonly snapshot: JobSnapshot;

	constructor(
		private readonly registry: WorkerRegistry,
		private readonly records: WorkerRecords,
		private readonly local: string,
		ps: Ps,
		private readonly log: Logger,
	) {
		this.snapshot = new JobSnapshot(new Git("/", { ps }));
	}

	/** The runner that takes the next job: connected, not draining, and idlest; none if there is none. */
	pick(): RemoteWorker | null {
		const ready = this.registry.workers.filter(
			(worker) =>
				worker.id !== this.local &&
				worker.connected &&
				worker.info.jobs === true &&
				this.records.of(worker.id)?.draining !== true,
		);
		ready.sort(
			(first, second) =>
				(this.running.get(first.id) ?? 0) - (this.running.get(second.id) ?? 0),
		);
		return ready[0] ?? null;
	}

	readonly run = async (request: Request): Promise<Response> => {
		const body = JobRequest.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return refuse(400, "usage", "send the worktree, project and command");
		}
		const runner = this.pick();
		if (runner === null) {
			return refuse(409, NO_RUNNER, "no runner has joined: run the job here");
		}
		const job = body.data;
		const abort = new AbortController();
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				const send = (event: JobEvent) =>
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				void this.execute(runner, job, abort.signal, send).finally(() =>
					controller.close(),
				);
			},
			cancel: () => abort.abort(),
		});
		return new Response(stream, {
			headers: { "content-type": "application/x-ndjson" },
		});
	};

	private async execute(
		runner: RemoteWorker,
		job: JobRequest,
		signal: AbortSignal,
		send: (event: JobEvent) => void,
	): Promise<void> {
		this.running.set(runner.id, (this.running.get(runner.id) ?? 0) + 1);
		try {
			const commit = await this.snapshot.take(job.worktree);
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
		} catch (error) {
			if (!signal.aborted) {
				this.log.info(`a job on runner ${runner.id} failed: ${String(error)}`);
				send({
					type: "error",
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		} finally {
			this.running.set(runner.id, (this.running.get(runner.id) ?? 1) - 1);
		}
	}
}
