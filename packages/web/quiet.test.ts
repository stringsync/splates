import { describe, expect, it } from "bun:test";
import type { Message } from "@stringsync/splates-server/conversations";
import { quietOf, quietText, quietTitle } from "./quiet";
import { conversation, message, second, tool } from "./testing";

describe("a quiet agent", () => {
	/** A working conversation whose agent last moved at `moved` seconds. */
	const working = (moved: number, more: Partial<Message> = {}) =>
		conversation({
			status: "running",
			messages: [
				{ ...message("user", "Run the tests"), at: second(0) },
				{
					...message("agent", "Running them."),
					at: second(1),
					until: second(moved),
					...more,
				},
			],
		});
	const minutes = (mins: number) => Date.parse(second(10 + mins * 60));

	it("flags an agent with nothing in flight after three minutes", () => {
		expect(quietOf(working(10), minutes(2.9))).toBeNull();
		expect(quietOf(working(10), minutes(4))).toEqual({
			for: "4m",
			running: null,
		});
	});

	it("gives a tool call in flight fifteen minutes", () => {
		const running = working(10, {
			parts: [tool({ title: "bun test", status: "in_progress" })],
		});
		expect(quietOf(running, minutes(14))).toBeNull();
		expect(quietOf(running, minutes(16))).toEqual({
			for: "16m",
			running: "bun test",
		});
	});

	it("names a compaction in flight", () => {
		const compacting = working(10, {
			parts: [
				{
					type: "compaction",
					id: "k1",
					status: "in_progress",
					trigger: "automatic",
					before: null,
					after: null,
					summary: null,
					at: second(10),
					until: null,
				},
			],
		});
		expect(quietOf(compacting, minutes(16))?.running).toBe("Compacting");
	});

	it("never flags an agent waiting on a permission ask", () => {
		const asking = {
			...working(10),
			ask: { at: second(10) } as never,
		};
		expect(quietOf(asking, minutes(60))).toBeNull();
	});

	it("never flags an agent not at work, or a turn stopped", () => {
		expect(quietOf({ ...working(10), status: "idle" }, minutes(60))).toBeNull();
		expect(
			quietOf(working(10, { stopped: second(20) }), minutes(60)),
		).toBeNull();
	});

	it("counts from a prompt sent while the agent has yet to answer", () => {
		const sent = conversation({
			status: "running",
			messages: [
				{ ...message("user", "Go"), at: second(0), sentAt: second(10) },
			],
		});
		expect(quietOf(sent, minutes(2))).toBeNull();
		expect(quietOf(sent, minutes(3))?.for).toBe("3m");
	});

	it("says hours past an hour", () => {
		expect(quietOf(working(10), minutes(65))?.for).toBe("1h 5m");
	});

	it("says how long, and what runs, in a row and a tooltip", () => {
		expect(quietText({ for: "4m", running: null })).toBe(
			"Possibly stuck · quiet 4m",
		);
		expect(quietTitle({ for: "16m", running: "bun test" })).toBe(
			"Possibly stuck: bun test has run 16m with no activity",
		);
	});
});
