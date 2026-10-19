import { describe, expect, it } from "bun:test";
import { ranFor } from "./automation-face";

describe("ranFor", () => {
	it("names the queued tasks and the task an event run was for", () => {
		expect(ranFor("task.done #3 #7 fix-upload")).toEqual({
			todos: [3, 7],
			task: "fix-upload",
		});
		expect(ranFor("task.created #12")).toEqual({ todos: [12], task: null });
	});

	it("names none for a scheduled run", () => {
		expect(ranFor("schedule")).toEqual({ todos: [], task: null });
	});
});
