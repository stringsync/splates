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

	/** Which way the pages' tabs run, from the root that decides it. */
	const orientation = (view: Awaited<ReturnType<Testing["open"]>>) =>
		view
			.getByRole("tablist")
			.closest("[data-slot=tabs]")
			?.getAttribute("data-orientation");

	it("puts the pages in a bar along the bottom of a phone, and down the side of anything wider", async () => {
		try {
			resize(390);
			expect(orientation(await testing.open())).toBe("horizontal");
			cleanup();

			resize(1280);
			expect(orientation(await testing.open())).toBe("vertical");
		} finally {
			resize(1024);
		}
	});
});
