import { beforeEach, describe, expect, it } from "bun:test";
import type { EvalLaunches, EvalLaunchSpec } from "./launch";
import { EvalLaunchRoutes } from "./launch-routes";

const launch = (sent: Record<string, unknown>) =>
	new Request("http://localhost/api/evals/launch", {
		method: "POST",
		body: JSON.stringify(sent),
	});

describe("EvalLaunchRoutes", () => {
	let started: EvalLaunchSpec[];
	let routes: EvalLaunchRoutes;

	beforeEach(() => {
		started = [];
		routes = new EvalLaunchRoutes({
			async start(spec: EvalLaunchSpec) {
				started.push(spec);
				return spec;
			},
		} as unknown as EvalLaunches);
	});

	it("starts the run its card names from the one body the Run button sends", async () => {
		const sent = {
			skill: "splates",
			probes: ["resources/install"],
			agents: [{ agent: "claude" }],
			baseline: "fd9f3785",
			key: "card-1",
		};

		const response = await routes.start(launch(sent));

		expect(response.status).toBe(200);
		expect(started).toEqual([sent]);
	});
});
