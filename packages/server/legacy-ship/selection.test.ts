import { describe, expect, it } from "bun:test";
import { ensure } from "core/assert";
import { readGraph } from "./graph";
import type { ShipHistory } from "./history";
import { ShipSelections } from "./selection";
import { servedProjects } from "./testing";

const history = { expected: async () => 1 } as unknown as ShipHistory;

async function graphWith(ship: string | null) {
	const { fs, sources } = await servedProjects();
	return readGraph(
		fs,
		sources.map((each) =>
			each.slug === "sound2score" ? { ...each, ship } : each,
		),
	);
}

describe("ShipSelections", () => {
	const choice = {
		projects: [
			{
				slug: "sound2score",
				bump: "patch" as const,
				adopt: "mechanical" as const,
				instructions: "",
			},
		],
	};

	it("selects a private project that names a ship command", async () => {
		const graph = await graphWith("bin/s2s ship");

		const { cascade } = await new ShipSelections(history).create(
			graph,
			choice,
			"2026-11-14T00:00:00Z",
		);

		expect(cascade.steps.map((step) => step.slug)).toEqual(["sound2score"]);
		expect(cascade.steps[0]?.to).not.toBeNull();
	});

	it("keeps declared inputs with the selected ship for history and retry", async () => {
		const graph = await graphWith("bin/s2s ship");
		const project = ensure.present(
			graph.projects.find((each) => each.slug === "sound2score"),
		);

		project.commandPlan = {
			schema: 1,
			identity: { kind: "commit", from: "aaaaaaa", to: "bbbbbbb" },
			resuming: false,
			steps: [],
			inputs: [
				{ name: "prod", label: "Production", type: "boolean", default: false },
				{ name: "region", label: "Region", type: "string", default: "east" },
			],
		};
		project.deploy = true;
		const selected = {
			...choice,
			projects: [
				{ ...ensure.present(choice.projects[0]), inputs: { prod: true } },
			],
		};
		const { cascade } = await new ShipSelections(history).create(
			graph,
			selected,
			"2026-11-14T00:00:00Z",
		);
		expect(cascade.steps[0]).toMatchObject({
			from: "aaaaaaa",
			to: "bbbbbbb",
			inputs: { prod: true, region: "east" },
		});
		expect(
			new ShipSelections(history).create(
				graph,
				{
					...choice,
					projects: [
						{ ...ensure.present(choice.projects[0]), inputs: { prod: "yes" } },
					],
				},
				"2026-11-14T00:00:00Z",
			),
		).rejects.toThrow("Invalid ship input");
	});

	it("refuses a project that names no ship command", async () => {
		const graph = await graphWith(null);

		expect(
			new ShipSelections(history).create(graph, choice, "2026-11-14T00:00:00Z"),
		).rejects.toThrow();
	});
});
