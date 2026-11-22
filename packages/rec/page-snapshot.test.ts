import { expect, test } from "bun:test";
import { FakeFs } from "core/system/testing";
import { FakeTimer, FakeWallClock } from "core/time/testing";
import type { Cdp, CdpEvent } from "./cdp";
import {
	type ChromeSnapshot,
	cleanSnapshot,
	PageSnapshots,
} from "./page-snapshot";
import { PointerEvents } from "./pointer";
import { POINTER_BINDING } from "./pointer-script";
import { Scrubber } from "./scrub";
import { eventPointers } from "./timeline";

test("structure retains hierarchy and geometry without unused strings, scripts or field values", () => {
	const docs = cleanSnapshot(raw, new Scrubber());
	const saved = JSON.stringify(docs);
	expect(saved).toContain("Visible");
	expect(saved).not.toContain("secret");
	expect(saved).not.toContain("private");
	expect(docs[0]?.nodes[1]?.bounds).toEqual([1, 2, 3, 4]);
	expect(docs[0]?.nodes[2]?.parent).toBe(1);
});

test("periodic captures deduplicate files, link timeline screenshots, and stop on disposal", async () => {
	const fs = new FakeFs();
	const timer = new FakeTimer();
	const events: unknown[] = [];
	let calls = 0;
	const snapshots = new PageSnapshots({
		fs,
		timer,
		wall: new FakeWallClock(1000),
		dir: "/s",
		scrubber: new Scrubber(),
		cdp: {
			send: async () => {
				calls++;
				return raw;
			},
		} as unknown as Cdp,
		active: () => "s",
		saved: (event) => events.push(event),
	});
	snapshots.capture("s", "mark", 900);
	await snapshots.flush();
	timer.fireIntervals();
	await snapshots.flush();
	expect(calls).toBe(2);
	expect(events).toHaveLength(2);
	expect(events[0]).toMatchObject({
		structure: "snapshots/0001.json",
		sourceAt: 900,
	});
	expect(events[1]).toMatchObject({
		structure: "snapshots/0001.json",
		trigger: "periodic",
	});
	const pointers = eventPointers(
		JSON.stringify({
			...(events[0] as object),
			still: "frames/0001-snapshot.jpg",
		}),
		0,
	);
	expect(pointers[0]?.text).toContain(
		"snapshots/0001.json -> frames/0001-snapshot.jpg",
	);
	snapshots.dispose();
	timer.fireIntervals();
	snapshots.capture("s", "click");
	await snapshots.flush();
	expect(calls).toBe(2);
});

test("hung Chrome captures cannot prevent saving the recording", async () => {
	const timer = new FakeTimer();
	let calls = 0;
	const snapshots = new PageSnapshots({
		fs: new FakeFs(),
		timer,
		dir: "/s",
		scrubber: new Scrubber(),
		cdp: {
			send: async () => {
				calls++;
				return new Promise(() => {});
			},
		} as unknown as Cdp,
		active: () => "s",
		saved: () => {
			throw new Error("must not save");
		},
	});
	snapshots.capture("s", "mark");
	timer.fireTimeouts();
	await snapshots.flush();
	timer.fireIntervals();
	expect(calls).toBe(1);
	snapshots.dispose();
});

test("clicks keep their screenshot and paired structure uses the same tab", async () => {
	const { fs, pointer, receive } = await pointerFixture();
	const at = Date.now();
	pointer.frame({ at, targetId: "tab", jpeg: new Uint8Array([1, 2, 3]) });
	pointer.frame({
		at: at + 10,
		targetId: "other-tab",
		jpeg: new Uint8Array([9]),
	});
	receive({
		method: "Runtime.bindingCalled",
		sessionId: "session",
		params: {
			name: POINTER_BINDING,
			payload: JSON.stringify({ at, type: "click", x: 1, y: 2 }),
		},
	});
	await pointer.flush();
	pointer.dispose();
	const events = (await fs.read("/s/events.jsonl"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	const click = events.find((event) => event.type === "click");
	const snapshot = events.find((event) => event.type === "snapshot");
	expect(click.still).toBeString();
	expect(snapshot.structure).toBe("snapshots/0001.json");
	expect(await fs.readBytes(`/s/${snapshot.still}`)).toEqual(
		new Uint8Array([1, 2, 3]),
	);
});

const raw: ChromeSnapshot = {
	strings: [
		"http://a.test/?token=private",
		"#document",
		"DIV",
		"#text",
		"Visible",
		"TEXTAREA",
		"typed secret",
		"SCRIPT",
		"script secret",
		"contenteditable",
		"true",
		"INPUT",
		"value",
		"field secret",
		"unused secret",
	],
	documents: [
		{
			documentURL: 0,
			nodes: {
				parentIndex: [-1, 0, 1, 0, 3, 0, 5, 0, 7, 0],
				nodeType: [9, 1, 3, 1, 3, 1, 3, 1, 3, 1],
				nodeName: [1, 2, 3, 5, 3, 7, 3, 2, 3, 11],
				nodeValue: [-1, -1, 4, -1, 6, -1, 8, -1, 6, -1],
				attributes: [[], [], [], [], [], [], [], [9, 10], [], [12, 13]],
			},
			layout: { nodeIndex: [1], bounds: [[1, 2, 3, 4]], styles: [[]] },
		},
	],
};

async function pointerFixture() {
	const fs = new FakeFs();
	let listener = (_event: CdpEvent) => {};
	const cdp = {
		send: async (method: string) => {
			switch (method) {
				case "Target.getTargets":
					return {
						targetInfos: [
							{ targetId: "tab", type: "page", url: "https://example.test" },
						],
					};
				case "Target.attachToTarget":
					return { sessionId: "session" };
				case "DOMSnapshot.captureSnapshot":
					return raw;
				default:
					return {};
			}
		},
		on: (callback: typeof listener) => {
			listener = callback;
			return { dispose() {} };
		},
	} as unknown as Cdp;
	const pointer = await PointerEvents.start({
		cdp,
		fs,
		dir: "/s",
		scrubber: new Scrubber(),
		skip: { skips: () => false },
		observer: { laser() {}, event() {} },
	});
	return { fs, pointer, receive: (event: CdpEvent) => listener(event) };
}
