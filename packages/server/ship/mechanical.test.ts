import { describe, expect, it } from "bun:test";
import { ensure } from "webappwiz/assert";
import { FakePs } from "webappwiz/system/testing";
import { enqueued } from "../board";
import { merge } from "../merge";
import { remove } from "../tasks";
import { Testing } from "../testing";
import type { Cascade, CascadeStep } from "./cascade";
import { MechanicalAdoption } from "./mechanical";

describe("mechanical ship adoption", () => {
	it("prepares an agent task and waits for it to be merged", async () => {
		await using repo = await Testing.open();
		await repo.fs.write(
			`${repo.root}/package.json`,
			JSON.stringify({ dependencies: { upstream: "^1.0.0" } }),
		);
		await repo.git.commitAll(repo.root, "Add upstream");
		const ps = new FakePs();
		const adoption = new MechanicalAdoption({
			...repo,
			ps,
			dispose: () => {},
		});
		const choice = {
			...step,
			adopt: "agent" as const,
			instructions: "Check compatibility verbatim.",
		};
		const run = adoption.run(
			ship,
			choice,
			[{ name: "upstream", version: "1.0.1" }],
			async () => {},
			{
				afterBump: ["refresh"],
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
					expect(await tree.commitsAhead()).toBe(1);
					expect(
						JSON.parse(await repo.fs.read(`${tree.path}/package.json`))
							.dependencies.upstream,
					).toBe("^1.0.1");
					expect(await repo.fs.read(`${tree.path}/SPLATES.md`)).toContain(
						choice.instructions,
					);
					await repo.fs.write(
						`${tree.path}/SPLATES.md`,
						"# ship task\n\n## Goal\n\nCheck compatibility.\n\n## Outcome\n\nChecked.\n",
					);
					await merge(repo, tree.path, {}, { message: "Adopt upstream" });
				},
			},
		);
		expect(await run).toBe(false);
		expect(ps.getCalls()).toEqual(["sh -c bun install", "sh -c refresh"]);
	});
	it("prepares an agent task and waits for it to be removed", async () => {
		await using repo = await Testing.open();
		await repo.fs.write(
			`${repo.root}/package.json`,
			JSON.stringify({ dependencies: { upstream: "^1.0.0" } }),
		);
		await repo.git.commitAll(repo.root, "Add upstream");
		const ps = new FakePs();
		const adoption = new MechanicalAdoption({
			...repo,
			ps,
			dispose: () => {},
		});
		const choice = {
			...step,
			adopt: "agent" as const,
			instructions: "Check compatibility verbatim.",
		};
		const run = adoption.run(
			ship,
			choice,
			[{ name: "upstream", version: "1.0.1" }],
			async () => {},
			{
				afterBump: ["refresh"],
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
					expect(await tree.commitsAhead()).toBe(1);
					expect(
						JSON.parse(await repo.fs.read(`${tree.path}/package.json`))
							.dependencies.upstream,
					).toBe("^1.0.1");
					expect(await repo.fs.read(`${tree.path}/SPLATES.md`)).toContain(
						choice.instructions,
					);
					await remove(repo, task, { reason: "moot" });
				},
			},
		);
		await expect(run).rejects.toThrow("removed without merging");
		expect(ps.getCalls()).toEqual(["sh -c bun install", "sh -c refresh"]);
	});
	it("installs and refreshes in a worktree, gates through merge, and skips matching base pins", async () => {
		await using repo = await Testing.open();
		await repo.fs.write(
			`${repo.root}/package.json`,
			JSON.stringify({
				name: "consumer",
				version: "1.0.0",
				dependencies: { upstream: "^1.0.0" },
			}),
		);
		await repo.git.commitAll(repo.root, "Add upstream dependency");
		const ps = new FakePs();
		ps.setCaptureOutput("installed\n", "");
		const adoption = new MechanicalAdoption({ ...repo, ps, dispose: () => {} });
		const output: string[] = [];
		await adoption.run(
			ship,
			step,
			[{ name: "upstream", version: "1.0.1" }],
			async (text) => {
				output.push(text);
			},
			{ afterBump: ["refresh"] },
		);
		expect(
			JSON.parse(await repo.fs.read(`${repo.root}/package.json`)),
		).toMatchObject({ dependencies: { upstream: "^1.0.1" } });
		expect(ps.getCalls()).toEqual(["sh -c bun install", "sh -c refresh"]);
		expect(await repo.service.list()).toEqual([]);
		expect(output.join("")).toContain("Adoption merged.");
		await adoption.run(
			ship,
			step,
			[{ name: "upstream", version: "1.0.1" }],
			async (text) => {
				output.push(text);
			},
			{ afterBump: ["refresh"] },
		);
		expect(ps.getCalls()).toHaveLength(2);
		expect(output.join("")).toContain("base already pins");
	});

	it("does not land an adoption rejected by the project's merge gate", async () => {
		await using repo = await Testing.open();
		repo.config.preMerge = "false";
		await repo.fs.write(
			`${repo.root}/package.json`,
			JSON.stringify({ dependencies: { upstream: "1.0.0" } }),
		);
		await repo.git.commitAll(repo.root, "Add upstream dependency");
		const adoption = new MechanicalAdoption({
			...repo,
			ps: new FakePs(),
			dispose: () => {},
		});
		await expect(
			adoption.run(
				ship,
				step,
				[{ name: "upstream", version: "1.0.1" }],
				async () => {},
				{ afterBump: [] },
			),
		).rejects.toMatchObject({ reason: "tests_failed" });
		expect(
			JSON.parse(await repo.fs.read(`${repo.root}/package.json`)),
		).toMatchObject({ dependencies: { upstream: "1.0.0" } });
	});

	it("keeps failed installation work off the base for Retry", async () => {
		await using repo = await Testing.open();
		await repo.fs.write(
			`${repo.root}/package.json`,
			JSON.stringify({ dependencies: { upstream: "1.0.0" } }),
		);
		await repo.git.commitAll(repo.root, "Add upstream dependency");
		const ps = new FakePs();
		ps.simulate(async () => 1);
		const adoption = new MechanicalAdoption({ ...repo, ps, dispose: () => {} });
		await expect(
			adoption.run(
				ship,
				step,
				[{ name: "upstream", version: "1.0.1" }],
				async () => {},
				{ afterBump: [] },
			),
		).rejects.toThrow("bun install exited 1");
		expect(
			JSON.parse(await repo.fs.read(`${repo.root}/package.json`)),
		).toMatchObject({ dependencies: { upstream: "1.0.0" } });
		expect(await repo.service.list()).toHaveLength(1);
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
