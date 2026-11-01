import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { MemoryLogger } from "core/log";
import { FakeFs, FakePs } from "core/system/testing";
import { FakeTimer } from "core/time/testing";
import { GUARD } from "../tunnel";
import { IDLE, PLAYWRIGHT_MCP, SharedBrowser } from "./shared-browser";
import { served } from "./testing";

const INSTALL = `bunx ${PLAYWRIGHT_MCP} install-browser chromium-headless-shell`;
const serve = (port: number) =>
	`sh -c ${GUARD} sh bunx ${PLAYWRIGHT_MCP} --config /home/.splates/playwright-mcp.json --port ${port} --allowed-hosts *`;

describe("SharedBrowser", () => {
	let ps: FakePs;
	let fs: FakeFs;
	let browser: SharedBrowser;
	let backend: { port: number; stop(force: boolean): void };

	beforeEach(async () => {
		ps = new FakePs();
		fs = new FakeFs();
		backend = Bun.listen({
			hostname: "127.0.0.1",
			port: 0,
			socket: { data: (socket, chunk) => void socket.write(chunk) },
		});
		browser = new SharedBrowser(
			{ ps, fs, timer: new FakeTimer(), log: new MemoryLogger() },
			"/home/.splates",
		);
		const asked = browser.servers();
		(await served(ps))?.print(
			`Listening on http://localhost:${backend.port}\nPut this in your client config:\n`,
		);
		await asked;
	});

	afterEach(async () => {
		await browser.disposeAsync();
		backend.stop(true);
	});

	it("offers one MCP on the headless shell to every session, and stops it on dispose", async () => {
		const offered = await browser.servers();

		expect(offered).toEqual([
			{
				type: "http",
				name: "playwright",
				url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
				headers: [],
			} satisfies acp.McpServer,
		]);
		expect(ps.getCalls()).toEqual([INSTALL, serve(0)]);
		expect(
			JSON.parse(await fs.read("/home/.splates/playwright-mcp.json")),
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
});
