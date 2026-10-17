import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeShell } from "./fake-shell";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	Testing,
	waitFor,
	within,
} from "./testing";

/** Ctrl+`, the chord that shows and hides the terminal. */
const TOGGLE = { key: "`", code: "Backquote", ctrlKey: true };

describe("App's conversation terminal on a page of its own", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The page with conversations on, `c1` in task alpha, opened at `hash`. */
	const opening = async (hash: string) => {
		testing.talk = {
			agents: [{ id: "claude", name: "Claude", settings: [], limits: [] }],
			conversations: [
				conversation({ id: "c1", name: "Fix it", task: "alpha" }),
			],
		};
		const view = await testing.open({ tasks: [details({ task: "alpha" })] });
		await go(hash);
		return view;
	};

	const go = (hash: string) =>
		act(async () => {
			location.hash = hash;
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});

	const press = (keys: Record<string, unknown>) =>
		act(async () => {
			fireEvent.keyDown(window, keys);
		});

	const click = (element: HTMLElement) =>
		act(async () => fireEvent.click(element));

	/** The terminal's page, which a main-tree terminal shows as well. */
	const page = (view: Awaited<ReturnType<typeof opening>>) =>
		view.queryByRole("region", { name: "terminal" });

	const pane = (view: Awaited<ReturnType<typeof opening>>) =>
		view.queryByRole("complementary", { name: "terminal" });

	it("opens by its address, in the conversation's tree, without the conversation", async () => {
		const view = await opening("#conversations/c1/terminal");

		await waitFor(() => expect(page(view)).toBeTruthy());
		expect(view.queryByRole("navigation", { name: "actions" })).toBeNull();
		expect(pane(view)).toBeNull();
		const bar = view.getByRole("heading", { name: "Terminal" }).parentElement
			?.parentElement?.textContent;
		expect(bar).toContain("Fix it");
		expect(bar).toContain("in alpha");
		expect(testing.shells.map((shell) => shell.task)).toEqual(["alpha"]);
		const [shell] = testing.shells;
		await act(async () => {
			shell?.accept();
			shell?.print("in the worktree");
		});
		await waitFor(() =>
			expect(view.getByTestId("terminal").textContent).toContain(
				"in the worktree",
			),
		);
	});

	it("says so for a conversation that is gone", async () => {
		const view = await opening("#conversations/c9/terminal");

		await waitFor(() => view.getByText("No such conversation"));
		expect(testing.shells).toEqual([]);
	});

	it("opens from the row the sidebar nests under the conversation, keeping its shell", async () => {
		const view = await opening("#conversations/c1");
		await waitFor(() => view.getByRole("navigation", { name: "actions" }));
		await press(TOGGLE);
		await act(async () => testing.shells[0]?.accept());
		const row = within(
			view.getByRole("navigation", { name: "conversations" }),
		).getByRole("button", { name: "Terminal" });

		await click(row);

		expect(location.hash).toBe("#conversations/c1/terminal");
		expect(page(view)).toBeTruthy();
		expect(pane(view)).toBeNull();
		expect(testing.shells).toHaveLength(1);
		expect(row.getAttribute("aria-current")).toBe("page");
	});

	it("opens its conversation beside the shell, and closes it again from the pane", async () => {
		const view = await opening("#conversations/c1/terminal");
		await waitFor(() => expect(page(view)).toBeTruthy());

		await click(view.getByRole("button", { name: "Open the conversation" }));

		expect(location.hash).toBe("#conversations/c1");
		await waitFor(() => view.getByRole("navigation", { name: "actions" }));
		expect(pane(view)).toBeTruthy();

		await click(view.getByRole("button", { name: "Close the conversation" }));

		expect(location.hash).toBe("#conversations/c1/terminal");
		expect(view.queryByRole("navigation", { name: "actions" })).toBeNull();
		expect(page(view)).toBeTruthy();
		expect(testing.shells).toHaveLength(1);
	});

	it("goes to the conversation once its shell exits, starting no other", async () => {
		const view = await opening("#conversations/c1/terminal");
		await waitFor(() => expect(page(view)).toBeTruthy());
		await act(async () => testing.shells[0]?.accept());

		await act(async () => testing.shells[0]?.exit(0));

		expect(location.hash).toBe("#conversations/c1");
		await waitFor(() => view.getByRole("navigation", { name: "actions" }));
		expect(pane(view)).toBeNull();
		expect(testing.shells).toHaveLength(1);
	});

	it("hangs up on its X, going to the conversation", async () => {
		const view = await opening("#conversations/c1/terminal");
		await waitFor(() => expect(page(view)).toBeTruthy());
		const [shell] = testing.shells;
		await act(async () => shell?.accept());

		await click(view.getByRole("button", { name: "Close the terminal" }));

		expect(location.hash).toBe("#conversations/c1");
		expect(shell?.readyState).toBe(FakeShell.CLOSED);
		expect(pane(view)).toBeNull();
		expect(testing.shells).toHaveLength(1);
	});
});
