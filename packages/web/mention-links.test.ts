import { describe, expect, it } from "bun:test";
import { mentionIn } from "./markdown";

describe("mentionIn", () => {
	it("reads a task number from a #todo- link, and from a #task- one", () => {
		expect(mentionIn("#todo-7")).toBe(7);
		expect(mentionIn("#task-7")).toBe(7);
	});

	it("leaves a started task's page and other links alone", () => {
		expect(mentionIn("#tasks/7")).toBeNull();
		expect(mentionIn("#task-fix-login")).toBeNull();
		expect(mentionIn("https://example.com/#todo-7")).toBeNull();
		expect(mentionIn(undefined)).toBeNull();
	});
});
