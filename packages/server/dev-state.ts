import type { Ps } from "webappwiz/system";
import { z } from "zod";
import type { Served } from "./dev-project";
import { fail } from "./exit";
import type { Projects } from "./projects";
import {
	type StateProject,
	StateRequest,
	sameOrigin,
	TokenRequest,
} from "./repo-state";
import { LandRequest } from "./trunk-landing";

/** What `POST /api/land` takes. */
const LandBody = z.object({
	project: StateRequest.shape.project,
	request: LandRequest,
});

/**
 * Answers `POST /api/state`: a command on a worker reading or writing its
 * project's records, which only the coordinator keeps. Each call names the
 * project by its slug or its origin URL, and reaches nothing outside that
 * project's `.git/splates`.
 */
export class StateRoutes {
	/** Each registered root's origin URL, as `sameOrigin` writes it, read once. */
	private readonly origins = new Map<string, Promise<string | null>>();

	constructor(
		private readonly deps: {
			ps: Ps;
			projects: Projects;
			/** The project `slug` names, opened. */
			named: (slug: string) => Promise<Served>;
			/** The project at `root`, opened. */
			at: (root: string) => Promise<Served>;
		},
	) {}

	readonly answer = async (request: Request): Promise<Response> => {
		const parsed = StateRequest.safeParse(
			await request.json().catch(() => null),
		);
		if (!parsed.success) {
			fail("usage", `not a call on a project's records: ${parsed.error}`, {});
		}
		const { project, call } = parsed.data;
		const served = await this.served(project);
		await served.format.check();
		return Response.json({ value: (await served.answerState(call)) ?? null });
	};

	/**
	 * Answers `POST /api/land`: a merge on a worker, holding the merge lease,
	 * asking the coordinator to move trunk to the branch it tested.
	 */
	readonly land = async (request: Request): Promise<Response> => {
		const parsed = LandBody.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			fail("usage", `not a landing: ${parsed.error}`, {});
		}
		const { project, request: landing } = parsed.data;
		const served = await this.served(project);
		await served.format.check();
		return Response.json({ value: await served.land(landing) });
	};

	/**
	 * Answers `POST /api/token`: a token for the project's own repository,
	 * minted for a worker's git to sign in with, never kept there; null
	 * when the project keeps no GitHub App, and the worker signs in as its
	 * machine does.
	 */
	readonly token = async (request: Request): Promise<Response> => {
		const parsed = TokenRequest.safeParse(
			await request.json().catch(() => null),
		);
		if (!parsed.success) {
			fail("usage", `not a token request: ${parsed.error}`, {});
		}
		const minted = await (await this.served(parsed.data.project)).mintToken();
		return Response.json({
			value:
				minted === null
					? null
					: { token: minted.token, expiresAt: minted.expiresAt.toISOString() },
		});
	};

	private served(project: StateProject): Promise<Served> {
		return "slug" in project
			? this.deps.named(project.slug)
			: this.byOrigin(project.origin);
	}

	private async byOrigin(origin: string): Promise<Served> {
		const wanted = sameOrigin(origin);
		for (const each of await this.deps.projects.list()) {
			if (!each.gone && (await this.originOf(each.root)) === wanted) {
				return this.deps.at(each.root);
			}
		}
		fail(
			"not_found",
			`no splates project here has the origin ${origin}: run \`splates init\` in its checkout on the coordinator's machine`,
			{ origin },
		);
	}

	private originOf(root: string): Promise<string | null> {
		let found = this.origins.get(root);
		if (found === undefined) {
			found = this.deps.ps
				.spawnCapture(["git", "-C", root, "remote", "get-url", "origin"])
				.then(({ exitCode, stdout }) =>
					exitCode === 0 && stdout.trim() !== "" ? sameOrigin(stdout) : null,
				);
			this.origins.set(root, found);
		}
		return found;
	}
}
