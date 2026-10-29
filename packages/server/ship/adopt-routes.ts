import { Duration, sleep } from "webappwiz/time";
import { fail } from "../exit";
import type { AgentNeed, Cascades } from "./cascade";

/** The longest a `next` waits on the server before answering that the run still waits. */
const LONGEST = Duration.secs(30);

/** How often a `next` that waits reads the run again. */
const EVERY = Duration.secs(1);

/** What the routes ask of the cascade under way. */
export type AdoptedCascades = Pick<
	Cascades,
	"need" | "adopt" | "landed" | "stopAt" | "handoff" | "resumed"
>;

/**
 * What the ship agent asks of a run it drives: `next` answers once the run
 * needs it, and the rest report what it did. A command out of turn is
 * refused, as the run's state says.
 */
export class AdoptRoutes {
	readonly #cascades: AdoptedCascades;

	constructor(cascades: AdoptedCascades) {
		this.#cascades = cascades;
	}

	/** Answers with what the run needs of the agent, waiting up to `wait` ms for it to need one. */
	readonly next = async (request: Request): Promise<Response> => {
		const asked = Number(new URL(request.url).searchParams.get("wait") ?? 0);
		const wait = Math.min(Number.isFinite(asked) ? asked : 0, LONGEST.ms);
		await this.#cascades.resumed();
		const until = Date.now() + wait;
		let need: AgentNeed = await this.#cascades.need();
		while (need.kind === "wait" && Date.now() < until) {
			await sleep(EVERY);
			need = await this.#cascades.need();
		}
		return Response.json(need);
	};

	readonly adopted = async (request: Request): Promise<Response> => {
		const body = await json(request);
		return Response.json(
			await this.#cascades.adopt(text(body, "project"), {
				task: text(body, "task"),
				path: text(body, "path"),
			}),
		);
	};

	readonly landed = async (request: Request): Promise<Response> =>
		Response.json(
			await this.#cascades.landed(text(await json(request), "project")),
		);

	readonly stopped = async (request: Request): Promise<Response> => {
		const body = await json(request);
		return Response.json(
			await this.#cascades.stopAt(text(body, "project"), text(body, "why")),
		);
	};

	readonly handoff = async (request: Request): Promise<Response> => {
		const task = (await json(request)).task;
		if (task !== undefined && task !== null && typeof task !== "number") {
			fail("usage", "`task` is a task number");
		}
		return Response.json(await this.#cascades.handoff(task ?? null));
	};
}

async function json(request: Request): Promise<Record<string, unknown>> {
	let value: unknown;
	try {
		value = JSON.parse((await request.text()) || "{}");
	} catch {
		fail("usage", "the body must be JSON");
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		fail("usage", "the body must be a JSON object");
	}
	return value as Record<string, unknown>;
}

function text(body: Record<string, unknown>, name: string): string {
	const value = body[name];
	if (typeof value !== "string" || value === "") {
		fail("usage", `name the \`${name}\``);
	}
	return value;
}
