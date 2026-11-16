// vet-ignore-file simple-test-setup: retain the existing protocol and CLI test groups while changing the default path expectation
import { describe, expect, test } from "bun:test";
import { FakeFs, FakePs } from "core/system/testing";
import { Duration, sleep } from "core/time";
import { parsePackets, summarize } from "./bench";
import { chromeArgs, parseActivePort } from "./chrome";
import { packFrame, unpackFrame } from "./protocol";
import { rec, sessionDir } from "./rec";
import { type Manifest, recordingName } from "./session";

describe("chrome", () => {
	test("debugs on its own profile and opens the working window on the url", () => {
		const args = chromeArgs({ profile: "/p", url: "http://x/" });
		expect(args).toContain("--user-data-dir=/p");
		expect(args).toContain("--remote-debugging-port=0");
		expect(args).toContain("--enable-unsafe-extension-debugging");
		expect(args.at(-1)).toBe("http://x/");
		expect(args).not.toContain("--use-fake-device-for-media-stream");
	});

	test("fakes the mic only when asked", () => {
		const args = chromeArgs({ profile: "/p", url: "x", fakeMedia: true });
		expect(args).toContain("--use-fake-device-for-media-stream");
	});

	test("reads the socket from DevToolsActivePort", () => {
		expect(parseActivePort("9222\n/devtools/browser/abc\n")).toBe(
			"ws://127.0.0.1:9222/devtools/browser/abc",
		);
		expect(parseActivePort("9222")).toBeUndefined();
	});
});

test("a frame keeps its time and bytes through the socket", () => {
	const packed = packFrame(1730000000123.5, new Uint8Array([1, 2, 3]));
	const { at, jpeg } = unpackFrame(packed.buffer as ArrayBuffer);
	expect(at).toBe(1730000000123.5);
	expect([...jpeg]).toEqual([1, 2, 3]);
});

test("the recording is named for its container", () => {
	expect(recordingName("video/webm;codecs=vp9,opus")).toBe("recording.webm");
	expect(recordingName("video/mp4")).toBe("recording.mp4");
});

describe("bench", () => {
	const streams = "0,video\n1,audio\n";
	const packets = [
		"0,0.000",
		"1,0.000",
		"0,0.033",
		"1,0.020",
		"0,N/A",
		"0,10.000",
		"1,10.050",
	].join("\n");

	test("counts each stream's packets and their span", () => {
		expect(parsePackets(streams, packets)).toEqual([
			{ kind: "video", count: 3, first: 0, last: 10 },
			{ kind: "audio", count: 3, first: 0, last: 10.05 },
		]);
	});

	test("reports rates, drift and CPU over the run", () => {
		const manifest: Manifest = {
			version: 1,
			startedAt: 0,
			stoppedAt: 10_000,
			sources: [],
			files: {},
			video: { mimeType: "video/webm", width: 1, height: 1 },
			stats: {
				arrived: 300,
				painted: 290,
				superseded: 10,
				repeats: 2,
				bytes: 5e6,
				latency: { p50: 20, p95: 40, max: 90 },
				received: 300,
				dropped: 0,
			},
		};
		const report = summarize(
			manifest,
			parsePackets(streams, packets),
			5e6,
			{
				at: 0,
				controlTask: 1,
				processes: [{ id: 1, type: "renderer", cpuTime: 2 }],
			},
			{
				at: 10_000,
				controlTask: 3,
				processes: [
					{ id: 1, type: "renderer", cpuTime: 4 },
					{ id: 2, type: "renderer", cpuTime: 1 },
					{ id: 3, type: "GPU", cpuTime: 5 },
				],
			},
		);
		expect(report.frames.receivedFps).toBe(30);
		expect(report.frames.paintedFps).toBe(29);
		expect(report.file.avDriftMs).toBe(-50);
		expect(report.file.videoVsWallMs).toBe(0);
		expect(report.file.megabytesPerMinute).toBe(30);
		expect(report.cpu.controlMainThreadPct).toBe(20);
		expect(report.cpu.byProcessType).toEqual({ renderer: 30, GPU: 50 });
	});
});

describe("sessionDir", () => {
	const deps = {
		ps: { env: () => "/home/u", cwd: () => "/cwd" },
		wall: { now: () => Date.UTC(2026, 0, 2, 3, 4, 5) },
	} as never;

	test("defaults to a timestamped folder in the session store", () => {
		expect(sessionDir(deps, undefined)).toBe(
			"/home/u/.rec/sessions/2026-01-02-03-04-05",
		);
	});

	test("--out wins", () => {
		expect(sessionDir(deps, "/tmp/x")).toBe("/tmp/x");
	});
});

/** Resolves once rec has started Chrome, past its setup. */
async function chromeStarted(ps: FakePs): Promise<void> {
	while (ps.getChildren().length === 0) {
		await sleep(Duration.ms(1));
	}
}

test.each(["SIGINT", "SIGTERM", "SIGHUP"])(
	"a rec sent %s while opening ends its Chrome and its server file",
	async (name) => {
		const ps = new FakePs();
		ps.setEnv({ HOME: "/home/u" });
		const fs = new FakeFs();
		const running = rec.run({ ps, fs, wall: { now: () => 0 } } as never, [
			"record",
			"--no-mic",
		]);
		await chromeStarted(ps);
		expect(await fs.exists("/home/u/.rec/server.json")).toBe(true);
		ps.dispatch(name);
		await running;
		expect(ps.getChildren()[0]?.signals).toEqual(["SIGTERM"]);
		expect(await fs.exists("/home/u/.rec/server.json")).toBe(false);
	},
);
