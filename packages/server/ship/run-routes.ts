import { fail } from "../exit";
import type { ShipBump } from "./plan";
import type { ShipRun, ShipRuns } from "./runs";

/**
 * The HTTP routes for planning a ship: serve each handler from a path to
 * start a plan, change it and propose it. Approving a plan is the one route
 * that starts the run, and only the page calls it.
 */
export class ShipRunRoutes {
	readonly #runs: ShipRuns;

	readonly #started: (
		run: ShipRun,
		conversation: string | null,
	) => Promise<void>;

	readonly #abandoned: (run: ShipRun) => Promise<void>;

	/**
	 * `started` logs a ship begun planning, in the conversation that asked for
	 * it; `abandoned` tells that conversation the person ended the ship.
	 */
	constructor(
		runs: ShipRuns,
		started: (
			run: ShipRun,
			conversation: string | null,
		) => Promise<void> = async () => {},
		abandoned: (run: ShipRun) => Promise<void> = async () => {},
	) {
		this.#runs = runs;
		this.#started = started;
		this.#abandoned = abandoned;
	}

	/** Answers with the run and its plan as drawn now, or null before any started. */
	readonly run = async (): Promise<Response> =>
		Response.json(
			(await this.#runs.current()) === null ? null : await this.#runs.show(),
		);

	/** Starts planning a ship of the body's `projects`; with none, plans the recovery of a stopped one. */
	readonly start = async (request: Request): Promise<Response> => {
		const body = await json(request);
		const projects = body.projects ?? [];
		if (
			!Array.isArray(projects) ||
			projects.some((each) => typeof each !== "string")
		) {
			fail("usage", "`projects` is a list of project slugs");
		}
		const shown = await this.#runs.start(
			projects as string[],
			typeof body.conversation === "string" ? body.conversation : null,
		);
		await this.#started(
			shown.run,
			typeof body.conversation === "string" ? body.conversation : null,
		);
		return Response.json(shown, { status: 201 });
	};

	readonly set = async (request: Request): Promise<Response> => {
		const body = await json(request);
		const bump = body.bump;
		if (
			bump !== undefined &&
			bump !== "patch" &&
			bump !== "minor" &&
			bump !== "major"
		) {
			fail("usage", "bump is patch, minor or major");
		}
		if (body.why !== undefined && typeof body.why !== "string") {
			fail("usage", "`why` is text");
		}
		return Response.json(
			await this.#runs.set(project(body), {
				bump: bump as ShipBump | undefined,
				why: body.why as string | undefined,
			}),
		);
	};

	readonly leaveOut = async (request: Request): Promise<Response> =>
		Response.json(await this.#runs.leaveOut(project(await json(request))));

	readonly note = async (request: Request): Promise<Response> => {
		const body = await json(request);
		if (typeof body.note !== "string") {
			fail("usage", "`note` is text");
		}
		return Response.json(await this.#runs.note(project(body), body.note));
	};

	readonly propose = async (): Promise<Response> =>
		Response.json(await this.#runs.propose());

	/** Names the body's `conversation` as the one driving the ship under way. */
	readonly attach = async (request: Request): Promise<Response> => {
		const body = await json(request);
		if (typeof body.conversation !== "string" || body.conversation === "") {
			fail("usage", "`conversation` is the id of the ship's conversation");
		}
		return Response.json(await this.#runs.attach(body.conversation));
	};

	/** Ends the ship under way, whether planning or running, and tells its conversation. */
	readonly abandon = async (): Promise<Response> => {
		const run = await this.#runs.abandon();
		await this.#abandoned(run);
		return Response.json(run);
	};

	/** Approves the frozen plan the body's `id` names, which starts the run from it. */
	readonly approve = async (request: Request): Promise<Response> => {
		const body = await json(request);
		if (typeof body.id !== "string") {
			fail("usage", "approval needs the plan id");
		}
		return Response.json(await this.#runs.approve(body.id));
	};
}

async function json(request: Request): Promise<Record<string, unknown>> {
	const text = await request.text();
	if (text === "") {
		return {};
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		fail("usage", "the body must be JSON");
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		fail("usage", "the body must be a JSON object");
	}
	return value as Record<string, unknown>;
}

function project(body: Record<string, unknown>): string {
	if (typeof body.project !== "string" || body.project === "") {
		fail("usage", "name the `project`");
	}
	return body.project;
}
