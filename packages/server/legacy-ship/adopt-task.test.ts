import { describe, expect, it } from "bun:test";
import { ensure } from "core/assert";
import { FakePs } from "core/system/testing";
import { enqueued } from "../board";
import { merge } from "../merge";
import { remove } from "../tasks";
import { Testing } from "../testing";
import { AdoptTask } from "./adopt-task";
import type { Cascade, CascadeStep } from "./cascade";

const request = {
	goal: "Adopt upstream@1.0.1 for this ship.",
	lines: ["upstream in package.json: catalog:"],
};

describe("ship adopt task", () => {
	it("prepares an agent task and resolves true once it merges", async () => {
		await using repo = await Testing.open();
		await repo.fs.write(`${repo.root}/package.json`, "{}");
		await repo.git.commitAll(repo.root, "Add manifest");
		const adoption = new AdoptTask({
			...repo,
			ps: new FakePs(),
			dispose: () => {},
		});
		const choice = { ...step, instructions: "Check compatibility verbatim." };
		const merged = await adoption.run(ship, choice, request, async () => {}, {
			agent: async (task) => {
				const owned = (await repo.tasks.all()).find(
					(each) => each.id === choice.task,
				);
				expect(owned?.state.ship).toMatchObject({
					run: ship.id,
					step: step.slug,
				});
				expect(() =>
					enqueued(ensure.defined(owned).state, { by: "person" }),
				).toThrow("ship alone");
				const tree = await repo.service.find(task);
				expect(tree.state?.lease).toBeFalsy();
				const plan = await repo.fs.read(`${tree.path}/SPLATES.md`);
				expect(plan).toContain(choice.instructions);
				expect(plan).toContain("catalog:");
				await repo.fs.write(
					`${tree.path}/SPLATES.md`,
					"# ship task\n\n## Goal\n\nAdopt.\n\n## Outcome\n\nAdopted.\n",
				);
				await merge(repo, tree.path, {}, { message: "Adopt upstream" });
			},
		});
		expect(merged).toBe(true);
	});

	it("resolves false once the task is removed without merging", async () => {
		await using repo = await Testing.open();
		await repo.fs.write(`${repo.root}/package.json`, "{}");
		await repo.git.commitAll(repo.root, "Add manifest");
		const adoption = new AdoptTask({
			...repo,
			ps: new FakePs(),
			dispose: () => {},
		});
		const merged = await adoption.run(ship, step, request, async () => {}, {
			agent: async (task) => {
				await remove(repo, task, { reason: "moot" });
			},
		});
		expect(merged).toBe(false);
	});
});

const step: CascadeStep = {
	slug: "consumer",
	action: "ship",
	from: "1.0.0",
	to: "1.0.1",
	bump: "patch",
	publishes: ["consumer"],
	takes: [],
	why: "selected",
	status: "bumping",
	task: null,
	ship: null,
	published: [],
	note: null,
	stages: [],
};
const ship: Cascade = {
	id: "2026-10-29-consumer",
	from: "consumer",
	status: "running",
	started: "2026-10-29T12:00:00Z",
	ended: null,
	steps: [step],
};
