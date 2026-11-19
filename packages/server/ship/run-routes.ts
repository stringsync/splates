import { z } from "zod";
import { type EventSink, eventStream } from "../server/http";
import type { ShipComposer } from "./compose";
import { ComposeError } from "./compose-error";
import type { ShipEngine } from "./engine";
import type { ShipFixes } from "./fixes";
import { RunError } from "./run-error";
import { type RunEvent, SUPERVISE } from "./run-events";
import { ShipStart } from "./start";
import { waitingIn } from "./waiting";
import { PICK } from "./wire";

const PICKS = z.object({
	picks: z.array(PICK).min(1),
	supervise: SUPERVISE.optional(),
});
/** How many more fixes the supervisor may send, at most a handful at a time. */
const SUPERVISE_MORE = z.object({ fixes: z.number().int().min(1).max(20) });
const STEP = z.object({ target: z.string(), step: z.string() });
const FIX_RETRY = STEP.extend({ task: z.string().min(1) });
const NOTE = z.object({
	task: z.string().min(1),
	text: z.string().trim().min(1),
	target: z.string().optional(),
	step: z.string().optional(),
	link: z.string().optional(),
});
const ANSWER = STEP.extend({ prompt: z.string(), value: z.unknown() });

const encoder = new TextEncoder();

/**
 * What the Ships page calls to start, watch and steer a ship:
 *
 * - `POST /api/ship/runs` with `{ picks, supervise? }` composes and starts a
 *   ship, supervised with `supervise.budget` fixes when given. Send
 *   it from the page: only the user starts a ship, so a request a browser
 *   did not send from the page is refused.
 * - `GET /api/ship/runs` every run, newest first, or with `?status=running`
 *   only the one under way; `GET /api/ship/runs/:id`
 *   one.
 * - `GET /api/ship/runs/:id/events` the run as it goes: a `state` event
 *   first, then a `run` event for each event of its file, which
 *   `applyRunEvent` folds into the state.
 * - `POST /api/ship/runs/:id/answer` with `{ target, step, prompt, value }`
 *   answers a waiting prompt; `POST /api/ship/runs/:id/retry` with
 *   `{ target, step }` sends a failed step round again.
 * - `POST /api/ship/runs/:id/supervise` with `{ fixes }` gives the run's
 *   supervisor that many more fixes, switching it on when it was off; from the
 *   page only, as the fixes spend the user's agents.
 * - `POST /api/ship/runs/:id/stop` ends the run's steps and records it as
 *   stopped; from the page only, as only the user stops a ship.
 * - `GET /api/ship/waiting` every prompt open in any run, for the nav to
 *   count, asked now and then.
 */
export class ShipRunRoutes {
	private readonly starting: ShipStart;

	constructor(
		private readonly engine: ShipEngine,
		composer: ShipComposer,
		private readonly fixes: ShipFixes | null = null,
	) {
		this.starting = new ShipStart(engine, composer);
	}

	readonly shipRuns = async (request: Request): Promise<Response> => {
		if (request.method !== "POST") {
			const status = new URL(request.url).searchParams.get("status");
			return Response.json({
				runs: await this.engine.list(status ?? undefined),
			});
		}
		if (request.headers.get("sec-fetch-site") !== "same-origin") {
			return Response.json(
				{
					error:
						"Only the user starts a ship, from the Ships page: an agent ends its reply with a card naming the targets and bumps",
				},
				{ status: 403 },
			);
		}
		const body = PICKS.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return Response.json(
				{ error: "send { picks: [{ name, bump? }], supervise?: { budget } }" },
				{ status: 400 },
			);
		}
		return answered(async () => {
			const state = await this.starting.picks(
				body.data.picks,
				body.data.supervise,
			);
			return Response.json(state, { status: 201 });
		});
	};

	readonly shipRun = (request: Request): Promise<Response> =>
		answered(async () => {
			const state = await this.engine.get(idOf(request));
			if (state === null) {
				throw new RunError(`No ship run is "${idOf(request)}"`, 404);
			}
			return Response.json(state);
		});

	readonly shipRunEvents = (request: Request): Promise<Response> =>
		answered(async () => {
			const listeners = new Set<EventSink>();
			const send = (name: string, data: unknown) => {
				const chunk = encoder.encode(
					`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`,
				);
				for (const each of listeners) {
					try {
						each.enqueue(chunk);
					} catch {
						// closed on the way: its cancel unsubscribes
					}
				}
			};
			const watch = await this.engine.subscribe(
				idOf(request),
				(event: RunEvent) => send("run", event),
			);
			return eventStream(listeners, {
				opened: () => send("state", watch.state),
				closed: () => watch.dispose(),
			});
		});

	readonly shipWaiting = async (): Promise<Response> =>
		Response.json((await this.engine.list()).flatMap(waitingIn));

	readonly shipRunAnswer = (request: Request): Promise<Response> =>
		answered(async () => {
			const body = ANSWER.safeParse(await request.json().catch(() => null));
			if (!body.success) {
				throw new RunError("send { target, step, prompt, value }", 400);
			}
			const { target, step, prompt, value } = body.data;
			return Response.json(
				await this.engine.answer(idOf(request), target, step, prompt, value),
			);
		});

	readonly shipRunRetry = (request: Request): Promise<Response> =>
		answered(async () => {
			const body = STEP.safeParse(await request.json().catch(() => null));
			if (!body.success) {
				throw new RunError("send { target, step }", 400);
			}
			const { target, step } = body.data;
			return Response.json(
				await this.engine.retry(idOf(request), target, step),
			);
		});

	readonly shipRunStop = (request: Request): Promise<Response> =>
		answered(async () => {
			if (request.headers.get("sec-fetch-site") !== "same-origin") {
				throw new RunError(
					"Only the user stops a ship, from the Ships page",
					403,
				);
			}
			return Response.json(await this.engine.stop(idOf(request)));
		});

	readonly shipRunSend = (request: Request): Promise<Response> =>
		answered(async () => {
			if (request.headers.get("sec-fetch-site") !== "same-origin") {
				throw new RunError(
					"Only the user sends a ship's step to an agent, from the Ships page",
					403,
				);
			}
			const fixes = this.fixes;
			if (fixes === null) {
				throw new RunError("Agents are off on this server", 404);
			}
			const body = STEP.safeParse(await request.json().catch(() => null));
			if (!body.success) {
				throw new RunError("send { target, step }", 400);
			}
			const { target, step } = body.data;
			return Response.json(await fixes.send(idOf(request), target, step));
		});

	readonly shipRunSupervise = (request: Request): Promise<Response> =>
		answered(async () => {
			if (request.headers.get("sec-fetch-site") !== "same-origin") {
				throw new RunError(
					"Only the user supervises a ship, from the Ships page",
					403,
				);
			}
			const body = SUPERVISE_MORE.safeParse(
				await request.json().catch(() => null),
			);
			if (!body.success) {
				throw new RunError("send { fixes }, from 1 to 20", 400);
			}
			const state = await this.engine.supervise(idOf(request), body.data.fixes);
			// A failed step waiting on a fix goes to an agent now.
			void this.fixes?.settle();
			return Response.json(state);
		});

	readonly shipRunNote = (request: Request): Promise<Response> =>
		answered(async () => {
			const body = NOTE.safeParse(await request.json().catch(() => null));
			if (!body.success) {
				throw new RunError("send { task, text, target?, step?, link? }", 400);
			}
			return Response.json(await this.engine.note(idOf(request), body.data));
		});

	readonly shipRunFixRetry = (request: Request): Promise<Response> =>
		answered(async () => {
			const fixes = this.fixes;
			if (fixes === null) {
				throw new RunError("Agents are off on this server", 404);
			}
			const body = FIX_RETRY.safeParse(await request.json().catch(() => null));
			if (!body.success) {
				throw new RunError("send { target, step, task }", 400);
			}
			const { target, step, task } = body.data;
			return Response.json(
				await fixes.retry(idOf(request), target, step, task),
			);
		});
}

/** `respond`'s answer, or the refusal a run or compose error is. */
async function answered(respond: () => Promise<Response>): Promise<Response> {
	try {
		return await respond();
	} catch (error) {
		if (error instanceof RunError) {
			return Response.json({ error: error.message }, { status: error.status });
		}
		if (error instanceof ComposeError) {
			return Response.json({ error: error.message }, { status: 400 });
		}
		throw error;
	}
}

/** The run id `/api/ship/runs/<id>/...` names. */
function idOf(request: Request): string {
	return decodeURIComponent(new URL(request.url).pathname.split("/")[4] ?? "");
}
