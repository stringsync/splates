import { describe, expect, it } from "bun:test";
import { TodoView } from "./todo-view";

describe("TodoView", () => {
	it("opens a task by name even when the page no longer lists it, for its finished record", () => {
		const view = new TodoView();

		view.openTask("merged-long-ago");

		expect(view.openedTask).toBe("merged-long-ago");
		view.closeTask();
		expect(view.openedTask).toBeNull();
	});
});
