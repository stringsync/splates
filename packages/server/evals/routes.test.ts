import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Testing } from "../testing";
import { EvalRoutes, projectEvalsDirectory } from "./routes";

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

		expect(projectEvalsDirectory(deps.ps, "/repo", null)).toBeNull();
		expect(projectEvalsDirectory(deps.ps, "/repo", { results: ".evals" })).toBe(
			"/repo/.evals",
		);
		expect(
			projectEvalsDirectory(deps.ps, "/repo", { results: "/abs/evals" }),
		).toBe("/abs/evals");
		expect(
			projectEvalsDirectory(deps.ps, "/repo", { results: "~/evals" }),
		).toBe(join(home, "evals"));
	});
});
