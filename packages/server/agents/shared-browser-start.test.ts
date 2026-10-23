import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { SharedBrowser } from "./shared-browser";
import { served } from "./testing";

describe("SharedBrowser starting", () => {
	let ps: FakePs;
	let timer: FakeTimer;
	let log: MemoryLogger;
	let browser: SharedBrowser;

	beforeEach(() => {
		ps = new FakePs();
		timer = new FakeTimer();
		log = new MemoryLogger();
		browser = new SharedBrowser(
			{ ps, fs: new FakeFs(), timer, log },
			"/home/.splates",
		);
	});

	it("offers none when the browser will not install, and tries again on the next ask", async () => {
		ps.simulate(async () => 1);
		ps.setCaptureOutput("", "offline");

		expect(await browser.servers()).toEqual([]);
		expect(ps.getChildren()).toEqual([]);
		expect(log.entries).toEqual([
			expect.objectContaining({
				message:
					"the shared browser did not install, so each agent runs its own: offline",
			}),
		]);

		ps.simulate(async () => 0);
		const again = browser.servers();
		(await served(ps))?.print("Listening on http://localhost:51235\n");

		expect(await again).toHaveLength(1);
	});

	it("offers none when the MCP dies before it listens, saying what it said", async () => {
		const asked = browser.servers();
		const child = await served(ps);
		child?.printError("EADDRINUSE\n");
		child?.exit(1);

		expect(await asked).toEqual([]);
		expect(log.entries).toEqual([
			expect.objectContaining({
				message:
					"the shared browser did not start, so each agent runs its own: EADDRINUSE",
			}),
		]);
	});

	it("gives up on an MCP that never says where it listens", async () => {
		const asked = browser.servers();
		const child = await served(ps);
		timer.fireTimeouts();

		expect(await asked).toEqual([]);
		expect(child?.signals).toEqual(["SIGTERM"]);
	});
});
