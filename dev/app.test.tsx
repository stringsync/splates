import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	details,
	fireEvent,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

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
		expect(
			view.getByRole("tab", { name: /Todos/ }).getAttribute("aria-selected"),
		).toBe("true");
		expect(view.queryByRole("tab", { name: /blocked/i })).toBeNull();
	});

	it("widens the sidebar by its edge, and keeps the width for the next visit", async () => {
		const view = await testing.open();
		const edge = view.getByRole("separator", { name: "Resize sidebar" });
		expect(edge.getAttribute("aria-valuenow")).toBe("224");

		fireEvent.keyDown(edge, { key: "ArrowRight" });
		fireEvent.keyDown(edge, { key: "ArrowRight" });
		expect(edge.getAttribute("aria-valuenow")).toBe("256");
		expect(localStorage.getItem("arbor.sidebarWidth")).toBe("256");

		fireEvent.doubleClick(edge);
		expect(edge.getAttribute("aria-valuenow")).toBe("224");
	});

	it("names the repo, and shows where it sits", async () => {
		const view = await testing.open();

		expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
			"webappwiz",
		);
		expect(view.getByText("~/Projects/webappwiz")).toBeTruthy();
	});

	it("shows the todos and the tasks on pages of their own, kept in the address", async () => {
		const view = await testing.open({
			tasks: [details({ task: "alpha" })],
			todos: [todo({ subject: "later" })],
		});

		expect(
			within(view.getByRole("region", { name: "Untriaged" })).getByText(
				/later/,
			),
		).toBeTruthy();
		expect(view.queryByText("alpha")).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Tasks/ })),
		);
		await waitFor(() => expect(view.getByText("alpha")).toBeTruthy());
		expect(view.queryByText("later")).toBeNull();
		expect(location.hash).toBe("#tasks");
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Todos/ })),
		);
		expect(location.hash).toBe("");
	});

	/** happy-dom answers media queries against this, 1024 wide to start. */
	const resize = (width: number) =>
		(
			window as unknown as {
				happyDOM: { setViewport(size: { width: number }): void };
			}
		).happyDOM.setViewport({ width });

	it("puts the pages beside the project name, on a phone and anything wider", async () => {
		try {
			for (const width of [390, 1280]) {
				resize(width);
				const view = await testing.open();
				expect(view.getByRole("tablist").closest("header")).not.toBeNull();
				cleanup();
			}
		} finally {
			resize(1024);
		}
	});
});
