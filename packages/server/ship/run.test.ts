import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "core/log";
import { FakeFs, FakePs } from "core/system/testing";
import { FakeWallClock } from "core/time/testing";
import { Exit } from "../exit";
import { FsStorage } from "../storage";
import { quietly } from "./npm-terminal";
import { eventsText } from "./release-steps";
import { Shipping } from "./run";
import { FakeReleaseGit, nth, until } from "./testing";

describe("Shipping", () => {
	let shipping: Shipping;
	let ps: FakePs;
	let fs: FakeFs;
	let storage: FsStorage;

	beforeEach(async () => {
		({ shipping, ps, fs, storage } = await project());
	});

	it("runs the ship command in the root with its approved bump", async () => {
		const started = await shipping.start("minor");
		const child = await nth(ps, 0);
		child.print("published 0.1.0\n");
		child.exit(0);
		await shipping.settled();

		expect(started).toMatchObject({
			project: "demo",
			status: "running",
			bump: "minor",
		});
		expect(ps.getCalls()).toEqual([quietly("wiz dev ship").join(" ")]);
		expect(ps.getCallDirs()).toEqual(["/demo"]);
		expect(ps.getCallEnvs()).toEqual([
			{
				npm_config_browser: "false",
				SPLATES_SHIP_BUMP: "minor",
				SPLATES_SHIP_EVENTS: `${shipping.output}.events`,
			},
		]);
		expect(await shipping.current()).toMatchObject({
			status: "done",
			step: "ship",
			from: "0.0.57",
			ended: "2026-10-27T12:00:00.000Z",
		});
		expect(await fs.read(shipping.output)).toBe(
			"origin/main verified at abc\npublished 0.1.0\norigin/main verified at abc\n",
		);
	});

	it("keeps the release steps its command writes, and names the one that failed", async () => {
		await shipping.start();
		const child = await nth(ps, 0);
		await fs.write(
			`${shipping.output}.events`,
			`${eventsText([
				{
					type: "declared",
					id: "build",
					name: "Build",
					stage: "build",
					packages: ["a"],
					deadlineMs: 1000,
					at: "t0",
				},
				{
					type: "declared",
					id: "tag",
					name: "Tag",
					stage: "tag",
					deadlineMs: 1000,
					at: "t0",
				},
				{ type: "started", id: "build", name: "Build", at: "t1" },
				{
					type: "failed",
					id: "build",
					name: "Build",
					error: "tsc broke",
					at: "t2",
				},
			])}not json\n`,
		);
		child.exit(1);
		await shipping.settled();
		const ship = await shipping.current();
		const command = ship?.stages?.find((each) => each.key === "command");
		expect(command?.releaseSteps?.map((each) => [each.id, each.state])).toEqual(
			[
				["build", "failed"],
				["tag", "pending"],
			],
		);
		expect(ship?.error).toBe('release step "Build" failed: tsc broke');
	});

	it("keeps no release steps when its command writes none", async () => {
		await shipping.start();
		(await nth(ps, 0)).exit(0);
		await shipping.settled();
		expect(
			(await shipping.current())?.stages?.find((each) => each.key === "command")
				?.releaseSteps,
		).toBeUndefined();
		expect((await shipping.current())?.status).toBe("done");
	});

	it("stops before npm when the push cannot be verified", async () => {
		const git = new FakeReleaseGit();
		git.failAt = 1;
		const { shipping, ps } = await project({ git });
		await shipping.start();
		await shipping.settled();
		expect(ps.getCalls()).toEqual([]);
		expect(await shipping.current()).toMatchObject({ status: "failed" });
		expect((await shipping.current())?.stages?.[0]).toMatchObject({
			key: "push",
			state: "failed",
		});
	});

	it("does not mark a ship done if the release commit cannot be verified on origin", async () => {
		const git = new FakeReleaseGit();
		git.failAt = 2;
		const { shipping, ps } = await project({ git });
		await shipping.start();
		(await nth(ps, 0)).exit(0);
		await shipping.settled();
		expect(git.calls).toBe(2);
		expect(await shipping.current()).toMatchObject({ status: "failed" });
		expect((await shipping.current())?.stages?.at(-1)).toMatchObject({
			key: "remote",
			state: "failed",
		});
	});

	it("runs the command through sh with echo off", () => {
		expect(quietly("wiz dev ship")).toEqual([
			"sh",
			"-c",
			"stty -echo 2>/dev/null; wiz dev ship",
		]);
	});

	it("answers the release's question yes", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		ship.print("\u001b[33mpublish 2 packages as 0.0.58? (y/n)\u001b[39m ");
		await until(async () => ship.typed.length > 0);

		ship.exit(0);
		await shipping.settled();
		expect(ship.typed).toEqual(["y\n"]);
	});

	it("keeps the end of the output as why a ship failed", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		ship.print("npm error 403 Forbidden\n");
		ship.exit(1);
		await shipping.settled();

		const failed = await shipping.current();
		expect(failed?.status).toBe("failed");
		expect(failed?.error).toContain("wiz dev ship exited 1");
		expect(failed?.error).toContain("npm error 403 Forbidden");
	});

	it("refuses a second ship while one runs, and a project that names none", async () => {
		await shipping.start();

		const again = await shipping.start().catch((error) => error);

		expect((again as Exit).reason).toBe("conflict");
		(await nth(ps, 0)).exit(0);
		await shipping.settled();

		const { shipping: none } = await project({ command: null });
		const refused = await none.start().catch((error) => error);
		expect(refused).toBeInstanceOf(Exit);
		expect((refused as Exit).reason).toBe("not_found");
	});

	it("records its steps, each with its slice of the log", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		ship.print("building\npublished 0.0.58\n");
		ship.exit(0);
		await shipping.settled();

		const stages = (await shipping.current())?.stages ?? [];
		expect(stages.map((stage) => [stage.key, stage.state])).toEqual([
			["push", "done"],
			["command", "done"],
			["remote", "done"],
		]);
		expect(stages[1]).toMatchObject({
			started: "2026-10-27T12:00:00.000Z",
			ended: "2026-10-27T12:00:00.000Z",
			log: { from: 28, to: 54 },
		});
	});

	it("adds to a log its cascade names, its slices counted from what was there", async () => {
		await fs.mkdir("/history/one", { recursive: true });
		await fs.write("/history/one/demo.log", "before\n");
		await shipping.start("patch", { log: "/history/one/demo.log" });
		const ship = await nth(ps, 0);
		ship.print("again\n");
		ship.exit(0);
		await shipping.settled();

		expect(await fs.read("/history/one/demo.log")).toBe(
			"before\norigin/main verified at abc\nagain\norigin/main verified at abc\n",
		);
		expect(await shipping.outputOf()).toBe("/history/one/demo.log");
		expect(
			(await shipping.current())?.stages?.find((each) => each.key === "command")
				?.log,
		).toEqual({ from: 35, to: 41 });
	});

	it("stops the ship under way at the person's word, failed", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		const stopping = shipping.stop();
		ship.exit(143);
		await stopping;

		expect(await shipping.current()).toMatchObject({
			status: "failed",
			error: "stopped: the person abandoned the ship",
		});
		expect(
			(await shipping.current())?.stages?.map((stage) => stage.state),
		).toEqual(["done", "failed", "skipped"]);
	});

	it("runs again a stopped server's ship at the bump it recorded", async () => {
		await shipping.start("major");
		await nth(ps, 0);
		shipping.dispose();
		await shipping.settled();
		expect((await shipping.current())?.status).toBe("running");

		const { shipping: restarted, ps: after } = await project({ storage, fs });
		await restarted.resume();
		(await nth(after, 0)).exit(0);
		await restarted.settled();

		expect(after.getCallEnvs()[0]).toEqual({
			npm_config_browser: "false",
			SPLATES_SHIP_BUMP: "major",
			SPLATES_SHIP_EVENTS: `${restarted.output}.events`,
		});
		expect(await restarted.current()).toMatchObject({
			status: "done",
			bump: "major",
			resumed: 1,
		});
	});
});

async function project({
	command = "wiz dev ship" as string | null,
	fs = new FakeFs(),
	storage = new FsStorage("/home/projects/1", fs),
	git = new FakeReleaseGit(),
}: {
	command?: string | null;
	fs?: FakeFs;
	storage?: FsStorage;
	git?: FakeReleaseGit;
} = {}) {
	await fs.mkdir("/demo", { recursive: true });
	await fs.write(
		"/demo/package.json",
		JSON.stringify({ name: "demo", version: "0.0.57" }),
	);
	const ps = new FakePs();
	const shipping = new Shipping({
		storage,
		git,
		fs,
		ps,
		log: new MemoryLogger(),
		root: "/demo",
		dir: "/home/projects/1",
		command,
		slug: async () => "demo",
		clock: new FakeWallClock(Date.parse("2026-10-27T12:00:00.000Z")),
	});
	return { shipping, ps, fs, storage, git };
}
