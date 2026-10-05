import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, details, Testing, todo, within } from "./testing";

describe("App", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("has no status line, and opens on the todos", async () => {
		const view = await testing.open();

		expect(view.queryByLabelText("banner")).toBeNull();
		expect(view.getByRole("textbox", { name: "new todo" })).toBeTruthy();
		expect(view.queryByRole("tab", { name: /blocked/i })).toBeNull();
	});

	it("names the repo, and shows where it sits", async () => {
		const view = await testing.open();

		expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
			"webappwiz",
		);
		expect(view.getByText("~/Projects/webappwiz")).toBeTruthy();
	});

	it("shows the tasks and the todos together, with no tabs", async () => {
		const view = await testing.open({
			tasks: [details({ task: "alpha" })],
			todos: [todo({ subject: "later" })],
		});

		expect(view.queryByRole("tablist")).toBeNull();
		expect(
			within(view.getByRole("region", { name: "Tasks" })).getByText("alpha"),
		).toBeTruthy();
		expect(
			within(view.getByRole("region", { name: "Todos" })).getByText(/later/),
		).toBeTruthy();
	});
});
