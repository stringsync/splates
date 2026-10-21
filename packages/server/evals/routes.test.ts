import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { EvalRoutes } from "./routes";

const request = (path: string) => new Request(`http://localhost${path}`);

describe("EvalRoutes", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("is not there from a release, which has no harness to read runs with", async () => {
		const routes = new EvalRoutes({ ps: deps.ps, checkout: null });

		expect(routes.available).toBe(false);
		await expect(routes.list(request("/api/evals"))).rejects.toThrow(
			"checkout",
		);
	});

	it("refuses a run id that leaves the results directory", async () => {
		const routes = new EvalRoutes({ ps: deps.ps, checkout: deps.root });

		await expect(
			routes.run(
				request(
					`/api/evals/run?id=${encodeURIComponent("../../x/result.json")}`,
				),
			),
		).rejects.toThrow("no eval run");
	});
});
