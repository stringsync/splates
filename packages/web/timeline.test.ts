import { describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates-server/records";
import { tool } from "./fixtures";
import { timeline } from "./timeline";
import type { Work } from "./work";

describe("Work timeline quiet events", () => {
	const at = (second: number) => new Date(second * 1000).toISOString();
	const read = (id: string, second: number): Event => ({
		id,
		at: at(second),
		action: "note read",
		task: null,
		reason: null,
		conversation: "c1",
		path: `notes/${id}.md`,
		hash: null,
		tool: id,
		subagent: false,
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
		const items = timeline(work([read("later", 6), read("between", 3)]));
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

	it("folds consecutive notes but keeps separate runs across calls", () => {
		const events = [read("one", 2), read("two", 3), read("three", 6)];
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
