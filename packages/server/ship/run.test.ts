import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FakeWallClock } from "webappwiz/time/testing";
import { Exit } from "../exit";
import { FsStorage } from "../storage";
import { inTerminal, Shipping, typedCodeError } from "./run";
import { nth, until } from "./testing";

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
			inTerminal("wiz dev ship").join(" "),
		]);
		expect(ps.getCallDirs()).toEqual(["/demo", "/demo"]);
		expect(ps.getCallEnvs()).toEqual([
			{},
			{ npm_config_browser: "false", SPLATES_SHIP_BUMP: "minor" },
		]);
		expect(await shipping.current()).toMatchObject({
			status: "done",
			step: "ship",
			from: "0.0.57",
			ended: "2026-10-27T12:00:00.000Z",
		});
		expect(await fs.read(shipping.output)).toBe("published 0.1.0\n");
	});

	it("gives npm a terminal, without which it fails a publish's second factor rather than asking", () => {
		expect(inTerminal("wiz dev ship", "darwin")).toEqual([
			"script",
			"-q",
			"/dev/null",
			"sh",
			"-c",
			"stty -echo 2>/dev/null; wiz dev ship",
		]);
		expect(inTerminal("wiz dev ship", "linux")).toEqual([
			"script",
			"-qfec",
			"stty -echo 2>/dev/null; wiz dev ship",
			"/dev/null",
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
			inTerminal("npm login --auth-type=web").join(" "),
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
		const typed = readAll(ship.received);
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
		expect(await typed).toBe("y\n");
	});

	it("stops a ship npm asks a typed one-time password of, saying how to have npm ask on its page", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		const typed = readAll(ship.received);
		ship.print("This operation requires a one-time password.\nEnter OTP: ");
		await shipping.settled();

		expect(await shipping.current()).toMatchObject({
			status: "failed",
			error: typedCodeError(null),
		});
		expect(await typed).toBe("");
	});

	it("keeps the end of the output as why a ship failed", async () => {
		await shipping.start();
		const ship = await nth(ps, 0);
		ship.printError("npm error 403 Forbidden\n");
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
			["login", "done"],
			["otp", "skipped"],
			["command", "done"],
		]);
		expect(stages[0]?.check?.result).toBe("npm whoami: someone");
		expect(stages[2]).toMatchObject({
			started: "2026-10-27T12:00:00.000Z",
			ended: "2026-10-27T12:00:00.000Z",
			log: { from: 0, to: 26 },
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
		expect(await otp()).toMatchObject({ state: "done", log: { from: 0 } });
	});

	it("adds to a log its cascade names, its slices counted from what was there", async () => {
		await fs.mkdir("/history/one", { recursive: true });
		await fs.write("/history/one/demo.log", "before\n");
		await shipping.start("patch", { log: "/history/one/demo.log" });
		const ship = await nth(ps, 0);
		ship.print("again\n");
		ship.exit(0);
		await shipping.settled();

		expect(await fs.read("/history/one/demo.log")).toBe("before\nagain\n");
		expect(await shipping.outputOf()).toBe("/history/one/demo.log");
		expect(
			(await shipping.current())?.stages?.find((each) => each.key === "command")
				?.log,
		).toEqual({ from: 7, to: 13 });
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
		).toEqual(["done", "skipped", "failed"]);
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
}: {
	command?: string | null;
	fs?: FakeFs;
	storage?: FsStorage;
} = {}) {
	await fs.mkdir("/demo", { recursive: true });
	await fs.write(
		"/demo/package.json",
		JSON.stringify({ name: "demo", version: "0.0.57" }),
	);
	const ps = new FakePs();
	const shipping = new Shipping({
		storage,
		fs,
		ps,
		log: new MemoryLogger(),
		root: "/demo",
		dir: "/home/projects/1",
		command,
		slug: async () => "demo",
		clock: new FakeWallClock(Date.parse("2026-10-27T12:00:00.000Z")),
	});
	return { shipping, ps, fs, storage };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
	return new Response(stream).text();
}
