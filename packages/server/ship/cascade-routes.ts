import type { Resource } from "webappwiz/disposable";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import { fail } from "../exit";
import type { Cascades } from "./cascade";
import { SHIP_SELECTION } from "./selection";
import type { StageKey } from "./stages";
import type { ShipSteps } from "./steps";

/** How often a page's stream of the cascade reads it again. */
const FEED_EVERY = Duration.secs(1);

/** The step keys a log slice may be asked for by. */
const STAGE_KEYS: StageKey[] = [
	"upstream",
	"adopt",
	"publish",
	"live",
	"bump",
	"gate",
	"merged",
	"push",
	"remote",
	"login",
	"otp",
	"command",
	"approve",
	"versions",
];

/** Legacy ship history and the live feed retained for ship displays. */
export class CascadeRoutes {
	readonly #cascades: Cascades;
	readonly #timer: Timer;

	constructor(cascades: Cascades, timer: Timer = new SystemTimer()) {
		this.#cascades = cascades;
		this.#timer = timer;
	}

	private steps(): ShipSteps {
		if (!("start" in this.#cascades)) {
			fail("usage", "ship steps are not configured");
		}
		return this.#cascades as ShipSteps;
	}

	readonly start = async (request: Request): Promise<Response> => {
		const result = SHIP_SELECTION.safeParse(await request.json());
		if (!result.success) {
			fail("usage", result.error.message);
		}
		return Response.json(await this.steps().start(result.data), {
			status: 201,
		});
	};
	readonly retry = async (): Promise<Response> =>
		Response.json(await this.steps().retry());
	readonly handToAgent = async (): Promise<Response> =>
		Response.json(await this.steps().handToAgent());
	readonly abandon = async (): Promise<Response> =>
		Response.json(await this.steps().abandon());

	/** The cascade under way, or the last to end, or null when none ran. */
	readonly cascade = async (): Promise<Response> =>
		Response.json(await this.#cascades.current());

	/** The cascades history keeps, newest first, each without its steps. */
	readonly history = async (): Promise<Response> =>
		Response.json(await this.#cascades.history.summaries());

	/** The cascade `/api/ship/history/<id>` names, with its steps and the ship under way. */
	readonly historyEntry = async (request: Request): Promise<Response> => {
		const id = idOf(request);
		return Response.json(
			(await this.#cascades.kept(id)) ??
				fail("not_found", `no ship ${id} in history`, { id }),
		);
	};

	/** What the step `?stage=` of `?project=`'s part in the cascade printed. */
	readonly historyLog = async (request: Request): Promise<Response> => {
		const id = idOf(request);
		const query = new URL(request.url).searchParams;
		const project = query.get("project") ?? "";
		const stage = query.get("stage") as StageKey;
		if (!STAGE_KEYS.includes(stage)) {
			fail("usage", `stage is one of ${STAGE_KEYS.join(", ")}`);
		}
		const text = await this.#cascades.stageLog(id, project, stage);
		return text === null
			? fail("not_found", `${project}'s ${stage} printed nothing in ${id}`, {
					id,
					project,
				})
			: new Response(text, {
					headers: { "content-type": "text/plain; charset=utf-8" },
				});
	};

	/**
	 * The cascade under way or the last to end, with its ship, as server-sent
	 * events: once as the page joins, then each time it changes.
	 */
	readonly cascadeEvents = async (): Promise<Response> => {
		const [cascades, timer] = [this.#cascades, this.#timer];
		const encoder = new TextEncoder();
		let last = "";
		let cancelled = false;
		let waiting: Resource | null = null;
		const next = async (
			stream: ReadableStreamDefaultController<Uint8Array>,
		): Promise<void> => {
			if (cancelled) {
				return;
			}
			const shown = JSON.stringify(await cascades.shown());
			if (shown !== last) {
				last = shown;
				stream.enqueue(encoder.encode(`data: ${shown}\n\n`));
			} else {
				// A comment, ignored by EventSource, so the page can tell the stream lives.
				stream.enqueue(encoder.encode(": pulse\n\n"));
			}
			waiting = timer.setTimeout(() => {
				void next(stream).catch((error: unknown) => stream.error(error));
			}, FEED_EVERY);
		};
		return new Response(
			new ReadableStream<Uint8Array>({
				start: (stream) => next(stream),
				cancel: () => {
					cancelled = true;
					waiting?.dispose();
				},
			}),
			{
				headers: {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
				},
			},
		);
	};
}

/** The cascade id `/api/ship/history/<id>` names. */
function idOf(request: Request): string {
	return decodeURIComponent(new URL(request.url).pathname.split("/")[4] ?? "");
}
