import { beforeEach, describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { GUARD } from "./cloudflared-tunnel-provider";
import { IDLE, PLAYWRIGHT_MCP, SharedBrowser } from "./shared-browser";
import { FREE, served } from "./shared-browser-testing";

const INSTALL = `bunx ${PLAYWRIGHT_MCP} install-browser chromium-headless-shell`;
const SERVE = `sh -c ${GUARD} sh bunx ${PLAYWRIGHT_MCP} --config /home/.arbor/playwright-mcp.json --port 0`;

describe("SharedBrowser", () => {
	let ps: FakePs;
	let fs: FakeFs;
	let browser: SharedBrowser;

	beforeEach(async () => {
		ps = new FakePs();
		fs = new FakeFs();
		browser = new SharedBrowser(
			{ ps, fs, timer: new FakeTimer(), log: new MemoryLogger(), heavy: FREE },
			"/home/.arbor",
		);
		const asked = browser.servers();
		(await served(ps))?.print(
			"Listening on http://localhost:51234\nPut this in your client config:\n",
		);
		await asked;
	});

	it("offers one MCP on the headless shell to every session, and stops it on dispose", async () => {
		const offered = await browser.servers();

		expect(offered).toEqual([
			{
				type: "http",
				name: "playwright",
				url: "http://localhost:51234/mcp",
				headers: [],
			} satisfies acp.McpServer,
		]);
		expect(ps.getCalls()).toEqual([INSTALL, SERVE]);
		expect(
			JSON.parse(await fs.read("/home/.arbor/playwright-mcp.json")),
		).toEqual({
			browser: {
				browserName: "chromium",
				isolated: true,
				launchOptions: { headless: true },
			},
			timeouts: { idle: IDLE.ms },
		});

		await browser.disposeAsync();

		expect(ps.getChildren()[0]?.signals).toEqual(["SIGTERM"]);
	});

	it("starts it again for the next session once it died", async () => {
		ps.getChildren()[0]?.exit(1);
		await Bun.sleep(1);
		const next = browser.servers();
		(await served(ps, 2))?.print("Listening on http://localhost:51236\n");

		expect((await next)[0]).toMatchObject({
			url: "http://localhost:51236/mcp",
		});
	});
});
