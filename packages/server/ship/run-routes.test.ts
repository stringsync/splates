import { describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { MemoryStorage } from "../storage/testing";
import { readGraph } from "./graph";
import { ShipRunRoutes } from "./run-routes";
import { ShipRuns } from "./runs";
import { servedProjects } from "./testing";

describe("ShipRunRoutes", () => {
	it("tells of a ship begun planning with the conversation that asked", async () => {
		const served = await servedProjects();
		const runs = new ShipRuns({
			storage: new MemoryStorage(),
			ids: new CounterIdProvider(),
			graph: () => readGraph(served.fs, served.sources),
			cascades: {
				current: async () => null,
				startPlan: async () => {
					throw new Error("not approved");
				},
			},
		});
		const started: { projects: string[]; conversation: string | null }[] = [];
		const routes = new ShipRunRoutes(runs, async (run, conversation) => {
			started.push({ projects: run.projects, conversation });
		});
		const response = await routes.start(
			new Request("http://x/api/ship/run", {
				method: "POST",
				body: JSON.stringify({ projects: ["webappwiz"], conversation: "c7" }),
			}),
		);
		expect(response.status).toBe(201);
		expect(started).toEqual([{ projects: ["webappwiz"], conversation: "c7" }]);
	});
});
