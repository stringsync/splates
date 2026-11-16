import { describe, expect, test } from "bun:test";
import { parseEvent, parseLaser, pickFrame } from "./pointer";
import { pointerSource } from "./pointer-script";
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
});

test("the page's laser messages are told apart from its events", () => {
	expect(parseLaser(JSON.stringify({ at: 1, type: "laser", on: true }))).toBe(
		true,
	);
	expect(parseLaser(JSON.stringify({ at: 1, type: "laser", on: false }))).toBe(
		false,
	);
	expect(parseLaser(JSON.stringify({ at: 1, type: "click" }))).toBeUndefined();
	expect(parseLaser("not json")).toBeUndefined();
	expect(
		parseEvent(
			JSON.stringify({ at: 1, type: "laser", on: true }),
			new Scrubber(),
		),
	).toBeUndefined();
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
