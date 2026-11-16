import { afterEach, describe, expect, test } from "bun:test";
import { FakeFs, FakePs } from "core/system/testing";
import { Duration, sleep } from "core/time";
import { Chrome } from "./chrome";

const PROFILE = "/p";
const OPTIONS = { profile: PROFILE, url: "http://x/" };

/** A DevTools socket that takes commands and never answers, as a hung Chrome does. */
function silentDevTools(): ReturnType<typeof Bun.serve> {
	return Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: (request, server) =>
			server.upgrade(request, { data: undefined })
				? undefined
				: new Response("no", { status: 400 }),
		websocket: { message: () => {} },
	});
}

/** Resolves once the launch has started Chrome, past its setup. */
async function chromeStarted(ps: FakePs): Promise<void> {
	while (ps.getChildren().length === 0) {
		await sleep(Duration.ms(1));
	}
}

test("a Chrome left on the profile by a dead rec is ended before launching", async () => {
	const ps = new FakePs();
	ps.setProcesses([
		{
			pid: 9,
			ppid: 1,
			pgid: 9,
			tpgid: 0,
			command: `Chrome --user-data-dir=${PROFILE} --new-window x`,
		},
		{
			pid: 10,
			ppid: 9,
			pgid: 9,
			tpgid: 0,
			command: `Helper --type=gpu-process --user-data-dir=${PROFILE}`,
		},
		{
			pid: 11,
			ppid: 1,
			pgid: 11,
			tpgid: 0,
			command: "Chrome --user-data-dir=/everyday",
		},
	]);
	setTimeout(() => ps.kill(9), 50);
	await Chrome.endStale(ps, PROFILE);
	expect(ps.getCalls()).toEqual(["kill -TERM 9"]);
});

describe("Chrome", () => {
	let devtools: ReturnType<typeof Bun.serve> | undefined;

	afterEach(() => {
		void devtools?.stop(true);
		devtools = undefined;
	});

	async function launched(ps: FakePs): Promise<Chrome> {
		const fs = new FakeFs();
		devtools = silentDevTools();
		const launching = Chrome.launch(ps, fs, OPTIONS);
		// The launch removes any old port file first, so write it once it has started.
		await chromeStarted(ps);
		await fs.write(
			`${PROFILE}/DevToolsActivePort`,
			`${devtools.port}\n/devtools/browser/x\n`,
		);
		return await launching;
	}

	test("an abort while it waits for the port ends the Chrome it started", async () => {
		const ps = new FakePs();
		const stop = new AbortController();
		const launching = Chrome.launch(ps, new FakeFs(), {
			...OPTIONS,
			signal: stop.signal,
		});
		await chromeStarted(ps);
		stop.abort();
		await launching.catch(() => undefined);
		expect(ps.getChildren()[0]?.signals).toEqual(["SIGTERM"]);
	});

	test("close signals nothing when Chrome quits on being asked", async () => {
		const ps = new FakePs();
		const chrome = await launched(ps);
		const child = ps.getChildren()[0];
		const closing = chrome.close();
		child?.exit(0);
		await closing;
		expect(child?.signals).toEqual([]);
	});

	test("close signals a Chrome that does not answer, and waits for it to go", async () => {
		const ps = new FakePs();
		const chrome = await launched(ps);
		await chrome.close(Duration.ms(5));
		expect(ps.getChildren()[0]?.signals).toEqual(["SIGTERM"]);
	});
});
