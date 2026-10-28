import type { Resource } from "webappwiz/disposable";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import { fail } from "../exit";
import type { Cascades } from "./cascade";
import type { ShipBump } from "./plan";
import type { StageKey } from "./stages";

/** How often a page's stream of the cascade reads it again. */
const FEED_EVERY = Duration.secs(1);

/** The step keys a log slice may be asked for by. */
const STAGE_KEYS: StageKey[] = [
	"bump",
	"gate",
	"merged",
	"push",
	"remote",
	"login",
	"otp",
	"command",
	"versions",
];

/**
 * The machine's ship cascade over HTTP, for `splates ship` and the page:
 * the one under way or the last to end, starting one from a project,
 * revising a project in it, abandoning it, and the
 * cascades history keeps, each with its steps and their logs.
 */
export class CascadeRoutes {
	// Only the person starts a ship: `splates ship` refuses an agent before
	// it asks, and the page's Approve is the person's own.
	readonly #cascades: Cascades;
	readonly #slugOf: (request: Request) => Promise<string>;
	readonly #timer: Timer;

	constructor(
		cascades: Cascades,
		/** The project a request names with `?project=`, or the focused one. */
		slugOf: (request: Request) => Promise<string>,
		timer: Timer = new SystemTimer(),
	) {
		this.#cascades = cascades;
		this.#slugOf = slugOf;
		this.#timer = timer;
	}

	/** The cascade under way, or the last to end, or null when none ran. */
	readonly cascade = async (): Promise<Response> =>
		Response.json(await this.#cascades.current());

	/** The plan to ship the project at `?bump=`, what Approve on the page starts. */
	readonly plan = async (request: Request): Promise<Response> =>
		Response.json(
			await this.#cascades.plan(
				await this.#slugOf(request),
				bumpOf(request),
				new URL(request.url).searchParams.get("retry") === "true",
			),
		);

	/**
	 * Starts the cascade of the project's ship, 201 with it; 200 with the one
	 * under way when there is one, which it does not start a second beside.
	 */
	readonly startCascade = async (request: Request): Promise<Response> => {
		const body = await request.text();
		let approval: { id: string; choices: Record<string, ShipBump> } | undefined;
		if (body !== "") {
			let value: { id?: unknown; choices?: unknown } | null;
			try {
				value = JSON.parse(body);
			} catch {
				fail("usage", "approval must be JSON");
			}
			if (
				typeof value?.id !== "string" ||
				typeof value.choices !== "object" ||
				value.choices === null ||
				Array.isArray(value.choices)
			) {
				fail(
					"usage",
					"approval needs the reviewed plan id and release choices",
				);
			}
			for (const bump of Object.values(value.choices)) {
				if (bump !== "patch" && bump !== "minor" && bump !== "major") {
					fail("usage", "bump is patch, minor or major");
				}
			}
			approval = value as { id: string; choices: Record<string, ShipBump> };
		}
		const { cascade, started } = await this.#cascades.start(
			await this.#slugOf(request),
			bumpOf(request),
			approval,
		);
		return Response.json(cascade, { status: started ? 201 : 200 });
	};

	/** Refuses changes to release types fixed by approval. */
	readonly reviseCascadeBump = async (request: Request): Promise<Response> => {
		const bump = bumpOf(request);
		if (bump === undefined) {
			fail("usage", "changing a pending publish needs `bump`");
		}
		return Response.json(
			await this.#cascades.revise(await this.#slugOf(request), bump),
		);
	};

	/** Ends the cascade under way, as {@link Cascades.abandon} does. */
	readonly abandonCascade = async (): Promise<Response> =>
		Response.json(await this.#cascades.abandon());

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

/** The `bump` a request names, or undefined to use patch. */
function bumpOf(request: Request): ShipBump | undefined {
	const bump = new URL(request.url).searchParams.get("bump");
	if (bump === null) {
		return undefined;
	}
	if (bump !== "patch" && bump !== "minor" && bump !== "major") {
		fail("usage", "bump is patch, minor or major");
	}
	return bump;
}
