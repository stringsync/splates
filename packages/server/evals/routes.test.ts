import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Testing } from "../testing";
import { EvalRoutes, projectEvalCommands } from "./routes";

const request = (path: string) => new Request(`http://localhost${path}`);

describe("EvalRoutes", () => {
	it("is not there for a project that names no results directory", async () => {
		const routes = new EvalRoutes({ directory: async () => null });

		await expect(routes.list(request("/api/evals"))).rejects.toThrow(
			"evals.results",
		);
	});

	it("refuses a run id that leaves the results directory", async () => {
		const routes = new EvalRoutes({ directory: async () => "/tmp/evals" });

		await expect(
			routes.run(request("/api/evals/run?id=..%2F..%2Fx%2Fresult.json")),
		).rejects.toThrow("no eval run");
		await expect(
			routes.run(request("/api/evals/run?id=..%2Fx%23c1")),
		).rejects.toThrow("no eval run");
	});

	it("reads the results directory against the project, or under home", async () => {
		await using deps = await Testing.open();
		const home = deps.ps.env("HOME") ?? "";
		const results = (results: string) =>
			projectEvalCommands(deps.ps, "/repo", { results })?.results;

		expect(projectEvalCommands(deps.ps, "/repo", null)).toBeNull();
		expect(results(".evals")).toBe("/repo/.evals");
		expect(results("/abs/evals")).toBe("/abs/evals");
		expect(results("~/evals")).toBe(join(home, "evals"));
	});

	it("names no command a project leaves out", async () => {
		await using deps = await Testing.open();

		expect(
			projectEvalCommands(deps.ps, "/repo", {
				results: ".evals",
				run: "make evals",
			}),
		).toEqual({
			root: "/repo",
			results: "/repo/.evals",
			list: null,
			run: "make evals",
			plan: null,
		});
	});
});
