import { describe, expect, it } from "bun:test";
import { ensure } from "core/assert";
import { readGraph } from "./graph";
import type { ShipHistory } from "./history";
import { ShipSelections } from "./selection";
import { servedProjects } from "./testing";

describe("ShipSelections of a release that died", () => {
	it("ships at the version it stopped at, whatever bump comes", async () => {
		const { fs, sources } = await servedProjects();
		const graph = await readGraph(
			fs,
			sources.map((each) =>
				each.slug === "sound2score" ? { ...each, ship: "bin/s2s ship" } : each,
			),
		);
		ensure.defined(
			graph.projects.find((each) => each.slug === "sound2score"),
		).commandPlan = {
			schema: 1,
			identity: { kind: "version", from: "0.1.0", to: "9.9.9" },
			resuming: true,
			inputs: [],
			steps: [],
		};

		const { cascade } = await new ShipSelections({
			expected: async () => 1,
		} as unknown as ShipHistory).create(
			graph,
			{
				projects: [
					{
						slug: "sound2score",
						bump: "major",
						adopt: "mechanical",
						instructions: "",
					},
				],
			},
			"2026-11-14T00:00:00Z",
		);

		expect(cascade.steps[0]?.to).toBe("9.9.9");
	});
});
