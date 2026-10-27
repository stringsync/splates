import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { Bumps } from "./bumps";

const takes = [
	{
		project: "webappwiz",
		pins: [
			{ name: "webappwiz", version: "0.0.51" },
			{ name: "@webappwiz/cli", version: "0.0.51" },
		],
	},
];

describe("Bumps", () => {
	let deps: Testing;
	let bumps: Bumps;

	beforeEach(async () => {
		deps = await Testing.open();
		bumps = new Bumps(deps);
	});

	afterEach(() => deps.disposeAsync());

	it("adds a bump task groomed and untriaged, queued by the ship", async () => {
		const id = await bumps.add(
			{ from: "webappwiz", origin: "/webappwiz" },
			takes,
		);

		const task = await deps.tasks.find(id);
		expect(task.subject).toBe(
			"Take webappwiz 0.0.51, @webappwiz/cli 0.0.51, from the ship of webappwiz",
		);
		expect(task.text).toContain("- `webappwiz` 0.0.51, from webappwiz");
		expect(task.state).toMatchObject({
			stage: "queued",
			groomed: true,
			lane: null,
			queuedBy: { by: "ship", project: "webappwiz" },
			origin: { project: "/webappwiz", task: null },
		});
		expect(await bumps.state(id)).toBe("open");
	});

	it("reads a bump off the board as merged or removed, as its finished record says", async () => {
		const merged = await bumps.add({ from: "a", origin: "/a" }, takes);
		const removed = await bumps.add({ from: "a", origin: "/a" }, takes);
		await deps.service.finished.record({
			id: merged,
			task: "bump",
			subject: "bump",
			ended: "merged",
			reason: null,
			base: "main",
			commit: "abc",
			startedAt: new Date(0).toISOString(),
			endedAt: new Date().toISOString(),
			conversation: null,
			took: [],
			plan: "",
		});
		await deps.tasks.delete(merged, "abc");
		await deps.tasks.delete(removed);

		expect(await bumps.state(merged)).toBe("merged");
		expect(await bumps.state(removed)).toBe("removed");
	});
});
