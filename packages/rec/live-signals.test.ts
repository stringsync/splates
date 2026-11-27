import { expect, test } from "bun:test";
import { LiveSignals, type SignalRow } from "./live-signals";

test("a failed request becomes a row with the frame then", () => {
	const rows: SignalRow[] = [];
	const live = new LiveSignals(
		{
			frameAt: (at) => ({
				at,
				jpeg: new Uint8Array([1, 2, 3]),
				targetId: "t",
			}),
		},
		{ row: (row) => rows.push(row) },
	);
	const at = new Date("2025-01-01T00:00:01Z").toISOString();
	live.log(
		"logs/network.log",
		`${at} ERROR GET example.com/api 500 20ms 0B fetch`,
	);
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		kind: "request-failed",
		title: "Request failed",
		thumbnail: "AQID",
	});
	expect(rows[0]?.detail).toContain("500");
});

test("a dead click arrives only once the stream has gone past it", () => {
	const rows: SignalRow[] = [];
	const live = new LiveSignals(
		{ frameAt: () => undefined },
		{ row: (row) => rows.push(row) },
	);
	live.event({ at: 1000, type: "quiet", selector: "button" });
	expect(rows).toHaveLength(0);
	live.event({ at: 7000, type: "route", url: "/x" });
	expect(rows.map((row) => row.title)).toEqual(["Click did nothing"]);
});

test("arrow and box highlights become shaped live rows with target details", () => {
	const rows: SignalRow[] = [];
	const live = new LiveSignals(
		{ frameAt: () => undefined },
		{ row: (row) => rows.push(row) },
	);
	live.event({
		at: 1000,
		type: "highlight",
		shape: "arrow",
		area: [10, 20, 120, 60],
		elements: [{ text: "Past due" }],
	});
	live.event({
		at: 2000,
		type: "highlight",
		shape: "box",
		area: [200, 100, 222, 108],
		elements: [{ text: "Failed renewals" }],
	});
	expect(rows).toEqual([
		{
			at: 1000,
			kind: "highlight",
			shape: "arrow",
			title: "Arrow",
			detail: "Pointed at Past due",
			thumbnail: undefined,
		},
		{
			at: 2000,
			kind: "highlight",
			shape: "box",
			title: "Boxed",
			detail: "Failed renewals · 222×108",
			thumbnail: undefined,
		},
	]);
});
