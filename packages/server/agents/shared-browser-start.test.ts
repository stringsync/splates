import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { SharedBrowser } from "./shared-browser";
import { FREE, served } from "./testing";

describe("SharedBrowser starting", () => {
	let ps: FakePs;
	let timer: FakeTimer;
	let log: MemoryLogger;
	let browser: SharedBrowser;
	/** What the browser did with the machine's heavy slots, in order. */
	let held: string[];
	/** What a slot waits on before it is taken; settled unless a test holds it back. */
	let slotFree: Promise<void>;

	beforeEach(() => {
		held = [];
		slotFree = Promise.resolve();
		ps = new FakePs();
		timer = new FakeTimer();
		log = new MemoryLogger();
		browser = new SharedBrowser(
			{
				ps,
				fs: new FakeFs(),
				timer,
				log,
				heavy: {
					...FREE,
					take: async ({ what }) => {
						await slotFree;
						held.push(`took ${what}`);
						return {
							env: {},
							[Symbol.asyncDispose]: async () => {
								held.push("gave back");
							},
						};
					},
				},
			},
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

	it("holds a heavy slot while the browser installs and its MCP starts", async () => {
		const asked = browser.servers();
		(await served(ps))?.print("Listening on http://localhost:51237\n");
		await asked;

		expect(held).toEqual(["took shared browser start", "gave back"]);
	});

	it("offers none rather than wait on a heavy slot every test run holds, giving it back once it comes", async () => {
		let free: () => void = () => {};
		slotFree = new Promise((resolve) => {
			free = resolve;
		});

		const asked = browser.servers();
		timer.fireTimeouts();

		expect(await asked).toEqual([]);
		expect(ps.getChildren()).toEqual([]);
		expect(log.entries).toEqual([
			expect.objectContaining({
				message:
					"every heavy slot is taken, so this agent runs its own browser; the next to start tries the shared one again",
			}),
		]);

		free();
		await Bun.sleep(0);
		expect(held).toEqual(["took shared browser start", "gave back"]);

		const again = browser.servers();
		(await served(ps))?.print("Listening on http://localhost:51238\n");
		expect(await again).toHaveLength(1);
	});

	it("gives up on an MCP that never says where it listens", async () => {
		const asked = browser.servers();
		const child = await served(ps);
		timer.fireTimeouts();

		expect(await asked).toEqual([]);
		expect(child?.signals).toEqual(["SIGTERM"]);
	});
});
