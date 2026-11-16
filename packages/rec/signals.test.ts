import { describe, expect, test } from "bun:test";
import { detectSignals } from "./signals";

const T0 = Date.parse("2026-11-03T12:00:00.000Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const event = (ms: number, rest: Record<string, unknown>) =>
	JSON.stringify({ at: T0 + ms, ...rest });
const kinds = (signals: { signal: string }[]) =>
	signals.map((signal) => signal.signal);

describe("signals", () => {
	test("marks, highlights and page errors come straight from events", () => {
		const signals = detectSignals(
			[
				event(100, { type: "mark" }),
				event(200, { type: "highlight", area: [1, 2, 3, 4] }),
				event(300, {
					type: "alert",
					kind: "toast",
					text: "Something went wrong",
				}),
			].join("\n"),
			[],
			T0,
		);
		expect(kinds(signals)).toEqual(["mark", "highlight", "page-error"]);
	});

	test("errors, failed and slow requests and docker ERROR lines", () => {
		const signals = detectSignals(
			"",
			[
				{
					source: "logs/console.log",
					text: `${iso(10)} ERROR boom\n${iso(20)} EXCEPTION Uncaught\n${iso(30)} INFO fine`,
				},
				{
					source: "logs/network.log",
					text: `${iso(40)} ERROR POST a.test/save 500 250ms 2.0kB application/json\n${iso(50)} INFO  GET a.test/slow 200 4000ms 1B text/html\n${iso(60)} INFO  GET a.test/ok 200 20ms 1B text/html`,
				},
				{ source: "logs/docker-api.log", text: `${iso(70)} ERROR db down` },
			],
			T0,
		);
		expect(kinds(signals)).toEqual([
			"console-error",
			"exception",
			"request-failed",
			"request-slow",
			"log-error",
		]);
	});

	test("three clicks inside a second are one rage click", () => {
		const click = (ms: number) =>
			event(ms, { type: "click", selector: "button.save" });
		const signals = detectSignals(
			[click(0), click(300), click(600), click(800)].join("\n"),
			[],
			T0,
		);
		expect(kinds(signals)).toEqual(["rage-click"]);
	});

	test("a click with no change, request or route is dead; one that asked is not", () => {
		const events = [
			event(0, { type: "click", selector: "a" }),
			event(0, { type: "quiet", selector: "a" }),
			event(10_000, { type: "click", selector: "b" }),
			event(10_000, { type: "quiet", selector: "b" }),
		].join("\n");
		const signals = detectSignals(
			events,
			[
				{
					source: "logs/network.log",
					text: `${iso(10_100)} INFO  GET a.test/x 200 20ms 1B text/html`,
				},
			],
			T0,
		);
		expect(kinds(signals)).toEqual(["dead-click"]);
		expect(signals[0]?.detail.selector).toBe("a");
	});

	test("the same element clicked three times over seconds, a failing request repeated and a route bounce are retries", () => {
		const click = (ms: number) =>
			event(ms, { type: "click", selector: "button.go" });
		const route = (ms: number, url: string) =>
			event(ms, { type: "route", url });
		const signals = detectSignals(
			[
				click(0),
				click(3000),
				click(6000),
				route(20_000, "http://a/x"),
				route(21_000, "http://a/y"),
				route(22_000, "http://a/x"),
			].join("\n"),
			[
				{
					source: "logs/network.log",
					text: `${iso(30_000)} ERROR GET a.test/q 502 5ms 0B -\n${iso(31_000)} ERROR GET a.test/q 502 5ms 0B -`,
				},
			],
			T0,
		);
		expect(signals.filter((signal) => signal.signal === "retry").length).toBe(
			3,
		);
	});
});
