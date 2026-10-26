import { Duration } from "webappwiz/time";
import { z } from "zod";
import { pulsing, refuse } from "../server/shared";
import type { JobSpec } from "./job";
import type { ScheduledJob } from "./scheduled-job";
import type { JobScheduler } from "./scheduler";

const AMOUNT = z.union([
	z.number().nonnegative(),
	z.object({ min: z.number().nonnegative(), max: z.number().nonnegative() }),
]);

const SPEC = z.object({
	what: z.string().min(1),
	task: z.string().optional(),
	conversation: z.string().optional(),
	priority: z.number().int(),
	requeueable: z.boolean().optional(),
	request: z.object({
		resources: z.record(z.string(), AMOUNT),
		walltimeMs: z.number().positive(),
		expectedMs: z.number().positive().optional(),
	}),
});

const encoder = new TextEncoder();

/**
 * The scheduler's routes: a job is submitted with `POST /api/jobs`, held
 * open on `GET /api/jobs/:id/events`, whose end finishes it as a holder
 * that died would, renewed with `POST /api/jobs/:id/renew` and finished
 * with `DELETE /api/jobs/:id`; `GET /api/jobs` lists the queue.
 */
export class JobRoutes {
	/** Each held job's stream, closed when the job ends another way. */
	readonly #streams = new Map<string, () => void>();

	constructor(private readonly scheduler: JobScheduler) {}

	readonly list = async (): Promise<Response> =>
		Response.json(this.scheduler.list());

	readonly submit = async (request: Request): Promise<Response> => {
		const parsed = SPEC.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return refuse(400, "usage", `not a job: ${parsed.error.message}`);
		}
		const { request: asked, ...rest } = parsed.data;
		const spec: JobSpec = {
			...rest,
			request: {
				resources: asked.resources,
				walltime: Duration.ms(asked.walltimeMs),
				...(asked.expectedMs === undefined
					? {}
					: { expected: Duration.ms(asked.expectedMs) }),
			},
		};
		const job = await this.scheduler.submit(spec);
		return Response.json({ id: job.id });
	};

	readonly events = async (request: Request): Promise<Response> => {
		const job = this.#jobAt(request);
		if (job === null) {
			return refuse(404, "not_found", "no such job");
		}
		return this.#stream(job);
	};

	readonly renew = async (request: Request): Promise<Response> => {
		const job = this.#jobAt(request);
		if (job === null) {
			return refuse(404, "not_found", "no such job");
		}
		await job.renew();
		return Response.json({ id: job.id });
	};

	readonly finish = async (request: Request): Promise<Response> => {
		const job = this.#jobAt(request);
		if (job !== null) {
			await job.finish();
			this.#streams.get(job.id)?.();
		}
		return Response.json({ ok: true });
	};

	#jobAt(request: Request): ScheduledJob | null {
		const id = new URL(request.url).pathname.split("/")[3] ?? "";
		return this.scheduler.find(id);
	}

	#stream(job: ScheduledJob): Response {
		let close: () => void = () => {};
		return new Response(
			new ReadableStream<Uint8Array>({
				start: (sink) => {
					const say = (event: string, data: unknown = null) => {
						try {
							sink.enqueue(
								encoder.encode(
									`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
								),
							);
						} catch {
							// Closed on the way.
						}
					};
					// Without a first chunk the response never reaches the client.
					sink.enqueue(encoder.encode(": connected\n\n"));
					if (job.allocation !== null) {
						say("started", job.allocation);
					} else if (job.place !== null) {
						say("placed", job.place);
					}
					const offs = [
						job.events.on("placed", (place) => say("placed", place)),
						job.events.on("started", (allocation) =>
							say("started", allocation),
						),
						job.events.on("preempted", () => say("preempted")),
						job.events.on("expired", () => {
							say("expired");
							close();
						}),
					];
					const pulse = pulsing(sink);
					close = () => {
						for (const off of offs) {
							off();
						}
						pulse.dispose();
						this.#streams.delete(job.id);
						try {
							sink.close();
						} catch {
							// Closed already.
						}
					};
					this.#streams.set(job.id, close);
				},
				// The holder went away: its job is over.
				cancel: () => {
					close();
					void job.finish();
				},
			}),
			{
				headers: {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
				},
			},
		);
	}
}
