import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { MemoryLogger } from "core/log";
import { FakeFs, FakePs } from "core/system/testing";
import { FakeTimer } from "core/time/testing";
import { SharedBrowser } from "./shared-browser";
import { served } from "./testing";

describe("SharedBrowser once the MCP died", () => {
	let ps: FakePs;
	let fs: FakeFs;
	let browser: SharedBrowser;
	let backend: { port: number; stop(force: boolean): void };
	let held: acp.McpServer | undefined;
	const printed = new Set<unknown>();

	beforeEach(async () => {
		ps = new FakePs();
		fs = new FakeFs();
		printed.clear();
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
			`Listening on http://localhost:${backend.port}\n`,
		);
		held = (await asked)[0];
		ps.getChildren()[0]?.exit(1);
		await Bun.sleep(1);
	});

	afterEach(async () => {
		await browser.disposeAsync();
		backend.stop(true);
	});

	const starts = () =>
		ps.getCalls().filter((call) => call.includes("--port")).length;

	/** Sends "hello" through the proxy, answering the MCP start it triggers. */
	async function talk(): Promise<string> {
		const url = new URL((held as { url: string }).url);
		const got = new Promise<string>((resolve) => {
			void Bun.connect({
				hostname: url.hostname,
				port: Number(url.port),
				socket: {
					open: (socket) => void socket.write("hello"),
					data: (socket, chunk) => {
						resolve(chunk.toString());
						socket.end();
					},
				},
			});
		});
		const child = await served(ps, 2);
		if (child !== undefined && !printed.has(child)) {
			printed.add(child);
			child.print(`Listening on http://localhost:${backend.port}\n`);
		}
		return got;
	}

	it("starts it again when a session connects, on the URL it already holds", async () => {
		expect(await talk()).toBe("hello");
		expect(starts()).toBe(2);
	});

	it("starts it once for connections that arrive together", async () => {
		expect(await Promise.all([talk(), talk()])).toEqual(["hello", "hello"]);
		expect(starts()).toBe(2);
	});

	it("offers the same URL to a splates restarted since", async () => {
		await browser.disposeAsync();
		const restarted = new SharedBrowser(
			{ ps, fs, timer: new FakeTimer(), log: new MemoryLogger() },
			"/home/.splates",
		);
		const asked = restarted.servers();
		(await served(ps, 2))?.print(
			`Listening on http://localhost:${backend.port}\n`,
		);

		expect((await asked)[0]).toEqual(held);
		await restarted.disposeAsync();
	});
});
