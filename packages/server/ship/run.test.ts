import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FakeWallClock } from "webappwiz/time/testing";
import { Exit } from "../exit";
import { FsStorage } from "../storage";
import { Shipping } from "./run";
import { nth, until } from "./testing";

describe("Shipping", () => {
	let shipping: Shipping;
	let ps: FakePs;
	let fs: FakeFs;
	let storage: FsStorage;

	beforeEach(async () => {
		({ shipping, ps, fs, storage } = await project());
	});

	it("runs the ship command in the root once npm says who is signed in", async () => {
		const started = await shipping.start();
		const child = await nth(ps, 0);
		child.print("published 0.0.58\n");
		child.exit(0);
		await shipping.settled();

		expect(started).toMatchObject({ project: "demo", status: "running" });
		expect(ps.getCalls()).toEqual(["npm whoami", "sh -c wiz dev ship"]);
		expect(ps.getCallDirs()).toEqual(["/demo", "/demo"]);
		expect(await shipping.current()).toMatchObject({
			status: "done",
			step: "ship",
			from: "0.0.57",
			ended: "2026-10-27T12:00:00.000Z",
		});
		expect(await fs.read(shipping.output)).toBe("published 0.0.58\n");
	});

	it("signs in through npm's web page first, showing its link until npm moves on", async () => {
		ps.simulate(async () => 1);

		await shipping.start();
		const login = await nth(ps, 0);
		login.print(
			"Login at:\nhttps://www.npmjs.com/login?next=/login/cli/abc\nPress ENTER to open in the browser...\n",
		);
		await until(async () => (await shipping.current())?.waiting !== null);

		expect(ps.getCalls()).toContain("npm login --auth-type=web");
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

	it("runs again a ship a stopped server left running, to finish it", async () => {
		await shipping.start();
		await nth(ps, 0);
		shipping.dispose();
		await shipping.settled();
		expect((await shipping.current())?.status).toBe("running");

		const { shipping: restarted, ps: after } = await project({ storage, fs });
		await restarted.resume();
		(await nth(after, 0)).exit(0);
		await restarted.settled();

		expect(await restarted.current()).toMatchObject({
			status: "done",
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
