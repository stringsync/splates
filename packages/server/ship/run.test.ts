import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FakeWallClock } from "webappwiz/time/testing";
import { Exit } from "../exit";
import { FsStorage } from "../storage";
import { eventsText } from "./release-steps";
import { quietly, Shipping, typedCodeError } from "./run";
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
		expect(ps.getCalls()).toEqual([
			"npm whoami",
			quietly("wiz dev ship").join(" "),
		]);
		expect(ps.getCallDirs()).toEqual(["/demo", "/demo"]);
		expect(ps.getCallEnvs()).toEqual([
			{},
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

	it("gives npm a terminal, without which it fails a publish's second factor rather than asking", () => {
		expect(quietly("wiz dev ship")).toEqual([
			"sh",
			"-c",
			"stty -echo 2>/dev/null; wiz dev ship",
		]);
	});

	it("signs in through npm's web page first, showing its link until npm moves on", async () => {
		ps.simulate(async () => 1);

		await shipping.start();
		const login = await nth(ps, 0);
		login.print(
			"Login at:\nhttps://www.npmjs.com/login?next=/login/cli/abc\nPress ENTER to open in the browser...\n",
		);
		await until(async () => (await shipping.current())?.waiting !== null);

		expect(ps.getCalls()).toContain(
			quietly("npm login --auth-type=web").join(" "),
		);
		expect((await shipping.current())?.waiting).toMatchObject({
			kind: "login",
			url: "https://www.npmjs.com/login?next=/login/cli/abc",
		});

		login.print("Logged in on https://registry.npmjs.org/.\n");
		await until(async () => (await shipping.current())?.waiting === null);
		login.exit(0);
		const ship = await nth(ps, 1);
		ship.exit(0);
		await shipping.settled();

		expect(await shipping.current()).toMatchObject({ status: "done" });
	});

	it("shows a publish's second factor, and answers the release's question yes", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		ship.print("\u001b[33mpublish 2 packages as 0.0.58? (y/n)\u001b[39m ");
		ship.print(
			"Authenticate your account at:\nhttps://www.npmjs.com/auth/cli/xyz\n",
		);
		await until(async () => (await shipping.current())?.waiting !== null);

		expect((await shipping.current())?.waiting).toMatchObject({
			kind: "2fa",
			url: "https://www.npmjs.com/auth/cli/xyz",
		});

		ship.exit(0);
		await shipping.settled();
		expect(ship.typed).toEqual(["y\n"]);
	});

	it("stops a ship npm asks a typed one-time password of, saying how to have npm ask on its page", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		ship.print("This operation requires a one-time password.\nEnter OTP: ");
		await shipping.settled();

		expect(await shipping.current()).toMatchObject({
			status: "failed",
			error: typedCodeError(null),
		});
		expect(ship.typed).toEqual([]);
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

	it("records its steps, each with its slice of the log, 2FA skipped when npm never asked", async () => {
		ps.setCaptureOutput("someone\n", "");
		await shipping.start();
		const ship = await nth(ps, 0);
		ship.print("building\npublished 0.0.58\n");
		ship.exit(0);
		await shipping.settled();

		const stages = (await shipping.current())?.stages ?? [];
		expect(stages.map((stage) => [stage.key, stage.state])).toEqual([
			["push", "done"],
			["login", "done"],
			["otp", "skipped"],
			["command", "done"],
			["remote", "done"],
		]);
		expect(stages[1]?.check?.result).toBe("npm whoami: someone");
		expect(stages[3]).toMatchObject({
			started: "2026-10-27T12:00:00.000Z",
			ended: "2026-10-27T12:00:00.000Z",
			log: { from: 28, to: 54 },
		});
	});

	it("waits on the person at a publish's second factor, then carries on", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		ship.print(
			"Authenticate your account at:\nhttps://www.npmjs.com/auth/cli/xyz\n",
		);
		await until(async () => (await shipping.current())?.waiting !== null);

		const otp = () =>
			shipping
				.current()
				.then((ship) => ship?.stages?.find((each) => each.key === "otp"));
		expect((await otp())?.state).toBe("asking");

		ship.print("+ demo@0.0.58\n");
		await until(async () => (await otp())?.state === "running");
		ship.exit(0);
		await shipping.settled();
		expect(await otp()).toMatchObject({ state: "done", log: { from: 28 } });
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
		).toEqual(["done", "done", "skipped", "failed", "skipped"]);
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

		expect(after.getCallEnvs()[1]).toEqual({
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
