import "../../../setup";
import { describe, expect, it } from "bun:test";
import type { Message } from "../conversations";
import { tool } from "./fixtures";
import { like } from "./thread-messages";
import { workingTimes } from "./working-report-time";

describe("working report timing", () => {
	const at = "2026-10-17T12:00:00.000Z";
	const until = "2026-10-17T12:02:14.000Z";
	const report = "## ⏳ Working alpha: on Claude Sonnet\n\nFollowing the plan.";
	const agent = (text: string, when: string): Message => ({
		role: "agent",
		parts: [{ type: "text", text, at: when }],
		plan: null,
		at: when,
		until: when,
	});
	const timing = (messages: Message[]) => {
		const thread = workingTimes(
			messages.map((message, index) => like(message, index, "c1")),
			messages,
		);
		const content = thread[0]?.content;
		if (typeof content === "string") {
			throw new Error("Expected parts");
		}
		return content?.find((part) => part.type === "data-report");
	};
	it("runs from the report timestamp while only tools and user prompts follow", () => {
		const first = agent(report, at);
		first.parts.push(tool({ at: until, until }));
		const user: Message = { ...agent("Carry on", until), role: "user" };
		expect(timing([first, user])).toMatchObject({
			data: { timing: { at, until: null } },
		});
	});
	it.each([
		"Here is what I found.",
		"## ⏳ Working beta\n\nFollowing the plan.",
	])("freezes at later agent text: %s", (text) => {
		expect(timing([agent(report, at), agent(text, until)])).toMatchObject({
			data: { timing: { at, until } },
		});
	});
	it("does not invent a start timestamp for old logs", () => {
		const old = agent(report, at);
		old.parts = [{ type: "text", text: report }];
		expect(timing([old])).toMatchObject({
			data: { report: { ending: "working" } },
		});
		expect(
			(timing([old]) as { data: { timing?: unknown } }).data.timing,
		).toBeUndefined();
	});
});
