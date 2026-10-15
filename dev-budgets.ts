import { body } from "./dev-http";
import type { Project } from "./dev-project";
import { fail } from "./exit";

/**
 * The routes a project's Budget page reads and changes its scry budgets
 * through, each answering with the report `scry budgets` prints. Spread one
 * into a project's routes.
 */
export class BudgetRoutes {
	// each route runs `scry budgets` through the repo's `wiz` command, so the
	// CLI stays the one place that knows how budgets are kept; each handler is
	// a property, so it can be spread
	readonly #project: Project;

	constructor(project: Project) {
		this.#project = project;
	}

	readonly listBudgets = (): Promise<Response> => this.#run([]);

	/** Sets a role's spend, or with none, gives it back to the configs. */
	readonly setBudget = async (request: Request): Promise<Response> => {
		const role = roleIn(request);
		const { spend } = await body(request);
		return spend === null || spend === undefined
			? this.#run(["reset", role])
			: this.#run(["set", role, String(spend)]);
	};

	readonly raiseBudget = async (request: Request): Promise<Response> => {
		const role = roleIn(request);
		const { tokens, for: span } = await body(request);
		return this.#run([
			"raise",
			role,
			String(tokens),
			...(span === undefined ? [] : ["--for", String(span)]),
		]);
	};

	/** Stops a role asking anything for a while, like `1d`. */
	readonly pauseBudget = async (request: Request): Promise<Response> => {
		const role = roleIn(request);
		const { for: span } = await body(request);
		return this.#run([
			"pause",
			role,
			...(span === undefined ? [] : ["--for", String(span)]),
		]);
	};

	readonly resumeBudget = (request: Request): Promise<Response> =>
		this.#run(["resume", roleIn(request)]);

	readonly endRaise = (request: Request): Promise<Response> => {
		const id = new URL(request.url).pathname.split("/")[4] ?? "";
		if (!/^\d+$/.test(id)) {
			fail("usage", `no raise ${id}: a raise is named by its number`, { id });
		}
		return this.#run(["end", id]);
	};

	/**
	 * Runs `scry budgets` with `args`, answering with its report, or its
	 * error as the refusal. The args go in as `sh`'s own, never into the
	 * command line, so nothing typed on the page is read by the shell.
	 */
	async #run(args: string[]): Promise<Response> {
		const { service, ps } = this.#project;
		const { exitCode, stdout, stderr } = await ps.spawnCapture(
			[
				"sh",
				"-c",
				`${service.config.wiz} "$@"`,
				"sh",
				"scry",
				"budgets",
				...args,
				"--format",
				"json",
			],
			{ cwd: service.git.root },
		);
		if (exitCode !== 0) {
			const message =
				stderr
					.trim()
					.split("\n")
					.at(-1)
					?.replace(/^error: /, "") || `scry budgets exited ${exitCode}`;
			fail("usage", message);
		}
		return Response.json(JSON.parse(stdout));
	}
}

function roleIn(request: Request): string {
	const role = new URL(request.url).pathname.split("/")[3] ?? "";
	if (role !== "som" && role !== "llm") {
		fail("usage", `a budget is som's or llm's: not ${role}`, { role });
	}
	return role;
}
