import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { LIVE_PID, Testing } from "../testing";
import { add } from "./add";
import { remove } from "./remove";

describe("remove", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("removes everything and says what was thrown away", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "unlanded work");
		const record = await deps.recordOf("alpha");

		await remove(deps, "alpha");

		expect(deps.out()).toContain("discarded 1 commit(s)");
		expect(await deps.fs.exists(worktree)).toBe(false);
		expect(await deps.fs.exists(record)).toBe(false);
		expect(await deps.gitCli(deps.root, "branch", "--list", "task/alpha")).toBe(
			"",
		);
	});

	it("keeps the removed task, and why, among the finished", async () => {
		await add(deps, "alpha");

		await remove(deps, "alpha", { reason: "moot" });

		expect(await deps.service.finished.list()).toEqual([
			expect.objectContaining({
				task: "alpha",
				ended: "removed",
				reason: "moot",
				commit: null,
			}),
		]);
	});

	it("keeps the screenshots its plan shows past its conversation and record", async () => {
		await add(deps, "alpha");
		const shots = [
			...((await (
				await deps.service.files("alpha")
			)?.store([{ name: "own.png", bytes: new Uint8Array([1]) }])) ?? []),
			...(await deps.service
				.attached("c1", "alpha")
				.store([{ name: "shot.png", bytes: new Uint8Array([2]) }])),
		];
		await deps.fs.write(
			`${(await deps.service.find("alpha")).path}/SPLATES.md`,
			shots.map((path) => `![shot](${path})`).join("\n"),
		);

		await remove(deps, "alpha");
		await deps.fs.rm(`${deps.splatesDir}/conversations/c1`, {
			recursive: true,
		});

		const plan =
			(
				await deps.service.finished.read(
					(await deps.service.finished.list())[0]?.key ?? "",
				)
			)?.plan ?? "";
		expect(await deps.fs.exists(shots[0] ?? "")).toBe(false);
		expect(plan).not.toContain(shots[0] ?? "");
		expect(plan).not.toContain(shots[1] ?? "");
		const shown = plan.split("\n").map((line) => line.slice(8, -1));
		expect(shown.every((path) => deps.service.finished.owns(path))).toBe(true);
		expect(
			await Promise.all(shown.map((path) => deps.fs.readBytes(path))),
		).toEqual([new Uint8Array([1]), new Uint8Array([2])]);
	});

	it("returns the tasks it put back", async () => {
		await add(deps, "alpha");

		expect(await remove(deps, "alpha")).toEqual({ released: [] });
	});

	it("tells 'already removed' apart from 'never existed'", async () => {
		await add(deps, "alpha");
		await remove(deps, "alpha");

		await expect(remove(deps, "alpha")).toBail("already_removed");
		await expect(remove(deps, "never")).toBail("not_found");
	});

	it("cleans up leftovers when the worktree directory is already gone", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.fs.rm(worktree, { recursive: true, force: true });

		await remove(deps, "alpha");

		expect(deps.out()).toContain("already gone");
		expect(await deps.gitCli(deps.root, "branch", "--list", "task/alpha")).toBe(
			"",
		);
	});

	it("refuses a tree another agent is driving, unless forced", async () => {
		await add(deps, "alpha");
		const worktree = await (await deps.service.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		await expect(remove(deps, "alpha")).toBail("lease_held", {
			message: "--force",
		});

		await remove(deps, "alpha", { force: true });
		expect(await deps.fs.exists(worktree.path)).toBe(false);
	});
});
