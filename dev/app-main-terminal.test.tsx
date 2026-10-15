import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "../conversations";
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

/** Alt+`, the chord that opens another terminal in the main tree. */
const ANOTHER = { key: "`", code: "Backquote", altKey: true };

describe("App's terminals in the main tree", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The page with conversations on, `id` open among `held`. */
	const reading = async (
		held: ConversationState[] = [conversation({ id: "c1", title: "Fix it" })],
		id = "c1",
	) => {
		testing.talk = {
			agents: [{ id: "claude", name: "Claude", settings: [], limits: [] }],
			conversations: held,
		};
		const view = await testing.open({ tasks: [details({ task: "alpha" })] });
		await go(`#conversations/${id}`);
		await waitFor(() => view.getByRole("navigation", { name: "actions" }));
		return view;
	};

	const go = (hash: string) =>
		act(async () => {
			location.hash = hash;
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});

	const press = (
		keys: Record<string, unknown>,
		target: Document | Element | Window = window,
	) =>
		act(async () => {
			fireEvent.keyDown(target, keys);
		});

	/** What the page sends as the socket opens: the size it settled on. */
	const sized = expect.objectContaining({ type: "resize" });

	/** Opens New, and its Terminal item. */
	const openTerminal = async (view: Awaited<ReturnType<typeof reading>>) => {
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New" })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: "Terminal" })),
			),
		);
	};

	/** The sidebar's rows for the main tree's terminals, by name. */
	const rows = (view: Awaited<ReturnType<typeof reading>>) =>
		within(view.getByRole("navigation", { name: "conversations" }))
			.queryAllByRole("button", { name: /^Terminal \d+$/ })
			.map((row) => row.textContent);

	const row = (view: Awaited<ReturnType<typeof reading>>, name: string) =>
		within(view.getByRole("navigation", { name: "conversations" })).getByRole(
			"button",
			{ name },
		);

	it("opens a shell in the main tree from New, on a page of its own, listed until closed", async () => {
		const view = await reading();
		expect(rows(view)).toEqual([]);

		await openTerminal(view);

		view.getByRole("region", { name: "terminal" });
		// Named in the page's bar, atop the shell.
		expect(
			view.getByRole("heading", { name: "Terminal 1" }).parentElement
				?.parentElement?.textContent,
		).toContain("in the main tree");
		expect(location.hash).toBe("#conversations/terminal/1");
		const [shell] = testing.shells;
		expect(shell?.task).toBeNull();
		await act(async () => {
			shell?.accept();
			shell?.print("on trunk");
		});
		await waitFor(() =>
			expect(view.getByTestId("terminal").textContent).toContain("on trunk"),
		);
		expect(row(view, "Terminal 1").getAttribute("aria-current")).toBe("page");
	});

	it("starts one opened by its address, as on a reload, and lists it", async () => {
		const view = await reading();

		await go("#conversations/terminal/3");

		view.getByRole("region", { name: "terminal" });
		expect(testing.shells.map((shell) => shell.task)).toEqual([null]);
		expect(rows(view)).toEqual(["Terminal 3"]);

		await openTerminal(view);
		expect(rows(view)).toEqual(["Terminal 3", "Terminal 4"]);
	});

	it("starts another shell each time, each with a row of its own to go back to", async () => {
		const view = await reading();
		await openTerminal(view);
		await act(async () => testing.shells[0]?.accept());

		await openTerminal(view);
		expect(location.hash).toBe("#conversations/terminal/2");
		expect(testing.shells).toHaveLength(2);
		expect(rows(view)).toEqual(["Terminal 1", "Terminal 2"]);

		await go("#conversations/c1");
		expect(view.queryByRole("region", { name: "terminal" })).toBeNull();
		await act(async () => fireEvent.click(row(view, "Terminal 1")));

		view.getByRole("region", { name: "terminal" });
		expect(view.getByRole("heading", { name: "Terminal 1" })).toBeTruthy();
		expect(testing.shells).toHaveLength(2);
		expect(testing.shells[0]?.readyState).toBe(1);
	});

	it("closes a shell's page and drops its row once it exits", async () => {
		const view = await reading();
		await openTerminal(view);
		await openTerminal(view);
		await act(async () => testing.shells[1]?.accept());

		await act(async () => testing.shells[1]?.exit(0));

		expect(rows(view)).toEqual(["Terminal 1"]);
		expect(view.queryByRole("region", { name: "terminal" })).toBeNull();
		expect(location.hash).toBe("#conversations/new");
		expect(testing.shells).toHaveLength(2);
	});

	it("hangs up on a shell and drops its row when closed, numbering the next past those left", async () => {
		const view = await reading();
		await openTerminal(view);
		await openTerminal(view);
		await act(async () => testing.shells[1]?.accept());

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Close Terminal 2" })),
		);

		expect(testing.shells[1]?.readyState).toBe(3);
		expect(testing.shells[0]?.readyState).toBe(0);
		expect(rows(view)).toEqual(["Terminal 1"]);
		expect(view.queryByRole("region", { name: "terminal" })).toBeNull();

		await openTerminal(view);
		expect(rows(view)).toEqual(["Terminal 1", "Terminal 2"]);
	});

	it("hangs up on a shell and leaves its page from the X in its bar", async () => {
		const view = await reading();
		await openTerminal(view);
		await act(async () => testing.shells[0]?.accept());

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Close the terminal" })),
		);

		expect(testing.shells[0]?.readyState).toBe(3);
		expect(rows(view)).toEqual([]);
		expect(view.queryByRole("region", { name: "terminal" })).toBeNull();
		expect(location.hash).toBe("#conversations/new");
	});

	it("opens another from its shortcut, shown beside Terminal in New, even from inside a shell", async () => {
		const view = await reading();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New" })),
		);
		const item = await waitFor(() =>
			view.getByRole("menuitem", { name: "Terminal" }),
		);
		expect(item.textContent).toContain("⌥`");
		await press({ key: "Escape", code: "Escape" });

		await press(ANOTHER);
		expect(location.hash).toBe("#conversations/terminal/1");
		await act(async () => testing.shells[0]?.accept());

		await press(
			ANOTHER,
			view.getByTestId("terminal").querySelector("textarea") ?? window,
		);
		expect(location.hash).toBe("#conversations/terminal/2");
		expect(rows(view)).toEqual(["Terminal 1", "Terminal 2"]);
		expect(testing.shells[0]?.sent).toEqual([sized]);
	});
});
