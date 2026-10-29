import { fail } from "../exit";
import type { ShipBump } from "./plan";
import type { ShipRuns } from "./runs";

/**
 * The ship run over HTTP. The `splates ship` commands plan through it; only
 * the page's Approve starts a run.
 */
export class ShipRunRoutes {
	readonly #runs: ShipRuns;

	constructor(runs: ShipRuns) {
		this.#runs = runs;
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
		return Response.json(await this.#runs.start(projects as string[]), {
			status: 201,
		});
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
