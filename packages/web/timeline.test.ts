import { describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates-server/records";
import { tool } from "./fixtures";
import { timeline } from "./timeline";
import type { Work } from "./work";

describe("Work timeline quiet events", () => {
	const at = (second: number) => new Date(second * 1000).toISOString();
	const updated = (id: string, second: number): Event => ({
		id,
		at: at(second),
		action: "task update",
		task: null,
		reason: null,
		conversation: "c1",
		number: 1,
		subject: "Update uploads",
		changed: {},
	});
	const work = (events: Event[]): Work => ({
		parts: [
			tool({ id: "first", at: at(1), command: "git status" }),
			tool({ id: "second", at: at(5), command: "git status" }),
		],
		events,
		at: at(0),
		until: at(8),
		plan: null,
		running: false,
		working: false,
		going: false,
	});

	it("places events by time and breaks repeated commands around them", () => {
		const items = timeline(work([updated("later", 6), updated("between", 3)]));
		expect(items.map((item) => item.type)).toEqual([
			"command",
			"event",
			"command",
			"event",
		]);
		expect(
			items.flatMap((item) => (item.type === "event" ? [item.event.id] : [])),
		).toEqual(["between", "later"]);
	});

	it("folds consecutive updates but keeps separate runs across calls", () => {
		const events = [updated("one", 2), updated("two", 3), updated("three", 6)];
		const items = timeline(work(events));
		expect(
			items
				.filter((item) => item.type === "event")
				.map((item) => [item.event.id, item.also.map((event) => event.id)]),
		).toEqual([
			["one", ["two"]],
			["three", []],
		]);
		expect(events).toHaveLength(3);
	});
});
