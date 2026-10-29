import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { Testing } from "../testing";
import type { Cascade, CascadeStep } from "./cascade";
import { MechanicalAdoption } from "./mechanical";

describe("mechanical ship adoption", () => {
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
