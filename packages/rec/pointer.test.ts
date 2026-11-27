import { describe, expect, test } from "bun:test";
import { parseEvent, parseLaser, pickFrame } from "./pointer";
import { POINTER_BINDING, pointerSource } from "./pointer-script";
import { Scrubber } from "./scrub";
import { eventPointers } from "./timeline";

const START = Date.parse("2026-11-03T12:00:00.000Z");

describe("pointer events", () => {
	test("text is scrubbed, routes lose query values and unknown payloads are dropped", () => {
		const scrub = new Scrubber();
		const click = parseEvent(
			JSON.stringify({
				at: 5,
				type: "click",
				x: 1,
				y: 2,
				component: "PayButton",
				text: "key sk-abcdefghijklmnopqrstuvwxyz",
				selector: "button.pay",
				box: [1, 2, 3, 4],
			}),
			scrub,
		);
		expect(click).toMatchObject({ type: "click", component: "PayButton" });
		expect(JSON.stringify(click)).not.toContain("abcdefghijklmnop");
		expect(
			parseEvent(
				JSON.stringify({
					at: 5,
					type: "route",
					url: "http://a.test/x?token=1",
				}),
				scrub,
			),
		).toEqual({ at: 5, type: "route", url: "a.test/x?token=_" });
		expect(
			parseEvent(JSON.stringify({ at: 5, type: "rest", x: 1, y: 1 }), scrub)
				?.type,
		).toBe("paused");
		expect(parseEvent("not json", scrub)).toBeUndefined();
		expect(
			parseEvent(JSON.stringify({ at: 5, type: "bogus" }), scrub),
		).toBeUndefined();
	});

	test("a still is the screen just after the event, else the nearest frame", () => {
		const frame = (at: number) => ({
			at,
			jpeg: new Uint8Array(),
			targetId: "",
		});
		const frames = [frame(100), frame(900), frame(1100), frame(2000)];
		expect(pickFrame(frames, 1000)?.at).toBe(1100);
		expect(pickFrame(frames, 50)?.at).toBe(100);
		expect(pickFrame([], 5)).toBeUndefined();
	});

	test("the timeline names clicks, typing, routes, highlights and new pauses only", () => {
		const events = [
			{ at: START + 1000, type: "move", x: 1, y: 1 },
			{ at: START + 2000, type: "paused", component: "Card", text: "Buy" },
			{ at: START + 3000, type: "paused", component: "Card", text: "Buy" },
			{
				at: START + 4000,
				type: "click",
				selector: "button.buy",
				still: "frames/0001-click.jpg",
			},
			{ at: START + 5000, type: "type", component: "SearchBox" },
			{ at: START + 6000, type: "route", url: "a.test/cart" },
			{
				at: START + 7000,
				type: "highlight",
				area: [1, 2, 30, 40],
				elements: [{ component: "Total" }],
			},
			{ at: START - 1000, type: "click" },
		]
			.map((event) => JSON.stringify(event))
			.join("\n");
		const lines = eventPointers(events, START).map(
			(pointer) => `${pointer.at} ${pointer.text}`,
		);
		expect(lines).toEqual([
			'2 paused over <Card> "Buy"',
			"4 click on (button.buy) -> frames/0001-click.jpg",
			"5 typed in <SearchBox>",
			"6 route changed to a.test/cart",
			"7 highlighted 30x40 at 1,2 over <Total>",
		]);
	});

	test("the injected source is a complete expression", () => {
		expect(() => new Function(`return ${pointerSource()}`)).not.toThrow();
	});

	test("the page script draws arrows on Option, boxes on Option+Command, locks on staggered release, and cancels on shortcuts", () => {
		const docListeners = new Map<
			string,
			((event: Record<string, unknown>) => void)[]
		>();
		const winListeners = new Map<string, (() => void)[]>();
		const sent: Record<string, unknown>[] = [];
		const strokes: { style: string; width: number }[] = [];
		const canvases: { removed: boolean; style: { cssText: string } }[] = [];
		class FakePath2D {
			ops: string[] = [];
			rect(...args: number[]) {
				this.ops.push(`rect:${args.join(",")}`);
			}
			moveTo(...args: number[]) {
				this.ops.push(`moveTo:${args.join(",")}`);
			}
			lineTo(...args: number[]) {
				this.ops.push(`lineTo:${args.join(",")}`);
			}
		}
		const fakeEl = {
			tagName: "BUTTON",
			classList: [],
			parentElement: null,
			innerText: "Past due",
			getAttribute: () => null,
			closest: () => null,
			getBoundingClientRect: () => ({ x: 40, y: 50, width: 80, height: 24 }),
		};
		const fakeDoc = {
			documentElement: {
				append: (node: { removed: boolean; style: { cssText: string } }) => {
					canvases.push(node);
				},
			},
			createElement: () => {
				const node = {
					width: 0,
					height: 0,
					style: { cssText: "", opacity: "1" },
					removed: false,
					remove() {
						this.removed = true;
					},
					getBoundingClientRect: () => ({ width: 1200, height: 800 }),
					getContext: () => ({
						lineCap: "",
						lineJoin: "",
						shadowColor: "",
						shadowBlur: 0,
						strokeStyle: "",
						lineWidth: 0,
						setTransform() {},
						clearRect() {},
						save() {},
						restore() {},
						stroke() {
							strokes.push({
								style: this.strokeStyle,
								width: this.lineWidth,
							});
						},
					}),
				};
				return node;
			},
			elementFromPoint: () => fakeEl,
			addEventListener: (
				type: string,
				fn: (event: Record<string, unknown>) => void,
			) => {
				const list = docListeners.get(type) ?? [];
				list.push(fn);
				docListeners.set(type, list);
			},
		};
		const fakeWin: Record<string, unknown> = {
			innerWidth: 1200,
			innerHeight: 800,
			devicePixelRatio: 2,
			[POINTER_BINDING]: (payload: string) => {
				sent.push(JSON.parse(payload) as Record<string, unknown>);
			},
			addEventListener: (type: string, fn: () => void) => {
				const list = winListeners.get(type) ?? [];
				list.push(fn);
				winListeners.set(type, list);
			},
		};
		fakeWin.top = fakeWin;
		const emit = (type: string, event: Record<string, unknown>) => {
			for (const fn of docListeners.get(type) ?? []) {
				fn(event);
			}
		};
		class FakeMutationObserver {
			observe() {}
		}
		const run = new Function(
			"window",
			"document",
			"location",
			"history",
			"MutationObserver",
			"Path2D",
			"HTMLElement",
			"Element",
			"HTMLInputElement",
			"HTMLTextAreaElement",
			"HTMLSelectElement",
			"CSS",
			pointerSource(),
		);
		run(
			fakeWin,
			fakeDoc,
			{ href: "http://example.test/" },
			{ pushState() {}, replaceState() {} },
			FakeMutationObserver,
			FakePath2D,
			class {},
			class {},
			class {},
			class {},
			class {},
			{ escape: (value: string) => value },
		);

		// 1. Hold Option, move, release -> arrow highlight with magenta halo+ink strokes.
		emit("pointermove", { clientX: 10, clientY: 20 });
		emit("keydown", { key: "Alt", metaKey: false, repeat: false });
		emit("pointermove", { clientX: 110, clientY: 80 });
		emit("keyup", { key: "Alt" });
		expect(sent.filter((item) => item.type === "laser")).toEqual([
			expect.objectContaining({ type: "laser", on: true, shape: "arrow" }),
			expect.objectContaining({ type: "laser", on: false }),
		]);
		expect(sent.filter((item) => item.type === "highlight")).toEqual([
			expect.objectContaining({
				type: "highlight",
				shape: "arrow",
				from: [10, 20],
				to: [110, 80],
			}),
		]);
		expect(strokes.some((item) => item.style === "#ff1f8f")).toBe(true);
		expect(strokes.some((item) => item.style === "white")).toBe(true);

		// 2. Start Option, add Command mid-drag -> upgrades to box, staggered Meta release freezes box without snapping back.
		sent.length = 0;
		emit("pointermove", { clientX: 200, clientY: 100 });
		emit("keydown", { key: "Alt", metaKey: false, repeat: false });
		emit("keydown", { key: "Meta", metaKey: true, repeat: false });
		emit("pointermove", { clientX: 400, clientY: 250 });
		emit("keyup", { key: "Meta" });
		emit("keyup", { key: "Alt" });
		expect(sent.filter((item) => item.type === "laser")).toEqual([
			expect.objectContaining({ type: "laser", on: true, shape: "arrow" }),
			expect.objectContaining({ type: "laser", on: true, shape: "box" }),
			expect.objectContaining({ type: "laser", on: false }),
		]);
		expect(sent.filter((item) => item.type === "highlight")).toEqual([
			expect.objectContaining({
				type: "highlight",
				shape: "box",
				from: [200, 100],
				to: [400, 250],
				area: [200, 100, 200, 150],
			}),
		]);

		// 3. Option+Command+I (DevTools) cancels draft with no highlight and removes canvas immediately.
		sent.length = 0;
		emit("keydown", { key: "Alt", metaKey: true, repeat: false });
		emit("pointermove", { clientX: 500, clientY: 300 });
		emit("keydown", { key: "i", metaKey: true, altKey: true, repeat: false });
		emit("keyup", { key: "Alt" });
		expect(sent.filter((item) => item.type === "highlight")).toEqual([]);
		expect(canvases.at(-1)?.removed).toBe(true);

		// 4. Accidental Option tap with tiny movement (< 12px) emits no highlight.
		sent.length = 0;
		emit("pointermove", { clientX: 300, clientY: 300 });
		emit("keydown", { key: "Alt", metaKey: false, repeat: false });
		emit("pointermove", { clientX: 304, clientY: 303 });
		emit("keyup", { key: "Alt" });
		expect(sent.filter((item) => item.type === "highlight")).toEqual([]);
	});
});

test("the page's laser messages are told apart from its events", () => {
	expect(
		parseLaser(
			JSON.stringify({ at: 1, type: "laser", on: true, shape: "arrow" }),
		),
	).toBe("arrow");
	expect(
		parseLaser(
			JSON.stringify({ at: 1, type: "laser", on: true, shape: "box" }),
		),
	).toBe("box");
	expect(parseLaser(JSON.stringify({ at: 1, type: "laser", on: true }))).toBe(
		"arrow",
	);
	expect(parseLaser(JSON.stringify({ at: 1, type: "laser", on: false }))).toBe(
		"off",
	);
	expect(parseLaser(JSON.stringify({ at: 1, type: "click" }))).toBeUndefined();
	expect(parseLaser("not json")).toBeUndefined();
	expect(
		parseEvent(
			JSON.stringify({ at: 1, type: "laser", on: true, shape: "arrow" }),
			new Scrubber(),
		),
	).toBeUndefined();
});

test("arrow and box highlights keep their shape and endpoints and format cleanly in the timeline", () => {
	const scrub = new Scrubber();
	const arrow = parseEvent(
		JSON.stringify({
			at: START + 2000,
			type: "highlight",
			shape: "arrow",
			from: [10, 20],
			to: [110, 80],
			path: [
				[10, 20],
				[110, 80],
			],
			area: [10, 20, 100, 60],
			elements: [{ component: "StatusBadge", text: "Past due" }],
		}),
		scrub,
	);
	const box = parseEvent(
		JSON.stringify({
			at: START + 4000,
			type: "highlight",
			shape: "box",
			from: [200, 100],
			to: [420, 210],
			path: [
				[200, 100],
				[420, 210],
			],
			area: [200, 100, 220, 110],
			elements: [{ component: "FailedRenewals" }],
		}),
		scrub,
	);
	expect(arrow).toMatchObject({
		type: "highlight",
		shape: "arrow",
		from: [10, 20],
		to: [110, 80],
	});
	expect(box).toMatchObject({
		type: "highlight",
		shape: "box",
		from: [200, 100],
		to: [420, 210],
	});
	const lines = eventPointers(
		[arrow, box].map((item) => JSON.stringify(item)).join("\n"),
		START,
	).map((pointer) => `${pointer.at} ${pointer.text}`);
	expect(lines).toEqual([
		'2 pointed arrow 100x60 at 10,20 at <StatusBadge> "Past due"',
		"4 boxed 220x110 at 200,100 over <FailedRenewals>",
	]);
});

test("a remark the person typed is listed as typed, apart from speech and agent marks", () => {
	const line = JSON.stringify({
		at: START + 2000,
		type: "mark",
		label: "the save button does nothing",
		by: "person",
	});
	expect(eventPointers(line, START)).toEqual([
		{ at: 2, label: "typed remark:", text: "the save button does nothing" },
	]);
});

test("a mark event is listed in the timeline where a spoken line would be, with its still", () => {
	const line = JSON.stringify({
		at: START + 4000,
		type: "mark",
		label: "reproducing: step 2 of 3",
		by: "agent",
		still: "frames/0001-mark.jpg",
	});
	expect(eventPointers(line, START)).toEqual([
		{
			at: 4,
			label: "remark:",
			text: "reproducing: step 2 of 3 -> frames/0001-mark.jpg",
		},
	]);
});
