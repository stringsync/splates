import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { FakeShell } from "./fake-shell";
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

	/** Opens the main tree's terminal from its shortcut. */
	const openTerminal = async (_view: Awaited<ReturnType<typeof reading>>) => {
		await press(ANOTHER);
	};

	/** The sidebar, unfolded, where the main tree's terminals are listed. */
	const inbox = async (view: Awaited<ReturnType<typeof reading>>) => {
		const nav = view.getByRole("navigation", { name: "conversations" });
		const more = within(nav).queryByRole("button", { name: /^See \d+ more$/ });
		if (more !== null) {
			await act(async () => fireEvent.click(more));
		}
		return nav;
	};

	/** The sidebar's rows for the main tree's terminals, by name, unfolding it. */
	const rows = async (view: Awaited<ReturnType<typeof reading>>) =>
		within(await inbox(view))
			.queryAllByRole("button", { name: /^Close / })
			.map((close) => close.getAttribute("aria-label")?.replace(/^Close /, ""));

	const row = async (view: Awaited<ReturnType<typeof reading>>, name: string) =>
		within(await inbox(view)).getByRole("button", { name });

	/** Renames the terminal `from` to `to` from its row in the sidebar. */
	const rename = async (
		view: Awaited<ReturnType<typeof reading>>,
		from: string,
		to: string,
	) => {
		const listed = await inbox(view);
		await act(async () =>
			fireEvent.click(
				within(listed).getByRole("button", { name: `Rename ${from}` }),
			),
		);
		const box = within(listed).getByRole("textbox", { name: `Rename ${from}` });
		await act(async () => {
			fireEvent.change(box, { target: { value: to } });
			fireEvent.keyDown(box, { key: "Enter" });
		});
	};

	it("opens a shell in the main tree from New, on a page of its own, listed until closed", async () => {
		const view = await reading();
		expect(await rows(view)).toEqual([]);

		await openTerminal(view);

		view.getByRole("region", { name: "terminal" });
		// Named in the page's bar, atop the shell; the bar fills in after the
		// page opens, so wait for it.
		const heading = await waitFor(() =>
			view.getByRole("heading", { name: "Terminal 1" }),
		);
		expect(heading.parentElement?.parentElement?.textContent).toContain(
			"in the main tree",
		);
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
		expect(await rows(view)).toEqual(["Terminal 1"]);
	});

	it("starts one opened by its address, as on a reload, and lists it", async () => {
		const view = await reading();

		await go("#conversations/terminal/3");

		view.getByRole("region", { name: "terminal" });
		expect(testing.shells.map((shell) => shell.task)).toEqual([null]);
		expect(await rows(view)).toEqual(["Terminal 3"]);

		await openTerminal(view);
		expect(await rows(view)).toEqual(["Terminal 3", "Terminal 4"]);
	});

	it("starts another shell each time, each with a row of its own to go back to", async () => {
		const view = await reading();
		await openTerminal(view);
		await act(async () => testing.shells[0]?.accept());

		await openTerminal(view);
		expect(location.hash).toBe("#conversations/terminal/2");
		expect(testing.shells).toHaveLength(2);
		expect(await rows(view)).toEqual(["Terminal 1", "Terminal 2"]);

		await go("#conversations/c1");
		expect(view.queryByRole("region", { name: "terminal" })).toBeNull();
		await act(async () => fireEvent.click(await row(view, "Terminal 1")));

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

		expect(view.queryByRole("region", { name: "terminal" })).toBeNull();
		expect(location.hash).toBe("#conversations/new");
		expect(testing.shells).toHaveLength(2);
		expect(await rows(view)).toEqual(["Terminal 1"]);
	});

	it("hangs up on a shell and drops its row when closed, numbering the next past those left", async () => {
		const view = await reading();
		await openTerminal(view);
		await openTerminal(view);
		await act(async () => testing.shells[1]?.accept());

		const listed = await inbox(view);
		await act(async () =>
			fireEvent.click(
				within(listed).getByRole("button", { name: "Close Terminal 2" }),
			),
		);

		expect(testing.shells[1]?.readyState).toBe(3);
		expect(testing.shells[0]?.readyState).toBe(0);
		expect(await rows(view)).toEqual(["Terminal 1"]);

		await openTerminal(view);
		expect(await rows(view)).toEqual(["Terminal 1", "Terminal 2"]);
	});

	it("asks before closing a shell that runs a job, hanging up only once confirmed", async () => {
		const view = await reading();
		await openTerminal(view);
		const shell = testing.shells[0] as FakeShell;
		await act(async () => shell.accept());
		shell.running = "bun run dev";
		const close = async () => {
			const listed = await inbox(view);
			await act(async () =>
				fireEvent.click(
					within(listed).getByRole("button", { name: "Close Terminal 1" }),
				),
			);
		};

		await close();
		const ask = view.getByRole("dialog", { name: "Close Terminal 1?" });
		expect(ask.textContent).toContain("It is still running bun run dev.");
		await act(async () =>
			fireEvent.click(within(ask).getByRole("button", { name: "Cancel" })),
		);
		expect(shell.readyState).toBe(1);
		expect(await rows(view)).toEqual(["Terminal 1"]);

		await close();
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("dialog")).getByRole("button", { name: "Close" }),
			),
		);
		expect(shell.readyState).toBe(3);
		expect(await rows(view)).toEqual([]);
	});

	it("renames a shell from its row, in the list and atop its page, going back to its number when cleared", async () => {
		const view = await reading();
		await openTerminal(view);

		await rename(view, "Terminal 1", "Dev server");

		expect(await rows(view)).toEqual(["Dev server"]);
		expect(localStorage.getItem("splates.terminal.names")).toBe(
			JSON.stringify({ "terminal/1": "Dev server" }),
		);
		await act(async () => fireEvent.click(await row(view, "Dev server")));
		expect(view.getByRole("heading", { name: "Dev server" })).toBeTruthy();

		await rename(view, "Dev server", " ");
		expect(await rows(view)).toEqual(["Terminal 1"]);
	});

	it("forgets a shell's name once closed, so the next under its number goes by that", async () => {
		const view = await reading();
		await openTerminal(view);
		await rename(view, "Terminal 1", "Logs");

		await act(async () =>
			fireEvent.click(
				within(await inbox(view)).getByRole("button", { name: "Close Logs" }),
			),
		);
		await openTerminal(view);

		expect(await rows(view)).toEqual(["Terminal 1"]);
	});

	it("hangs up on a shell and leaves its page from the X in its bar", async () => {
		const view = await reading();
		await openTerminal(view);
		await act(async () => testing.shells[0]?.accept());

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Close the terminal" })),
		);

		expect(testing.shells[0]?.readyState).toBe(3);
		expect(view.queryByRole("region", { name: "terminal" })).toBeNull();
		expect(location.hash).toBe("#conversations/new");
		expect(await rows(view)).toEqual([]);
	});

	it("opens another from its shortcut, even from inside a shell", async () => {
		const view = await reading();

		await press(ANOTHER);
		expect(location.hash).toBe("#conversations/terminal/1");
		await act(async () => testing.shells[0]?.accept());

		await press(
			ANOTHER,
			view.getByTestId("terminal").querySelector("textarea") ?? window,
		);
		expect(location.hash).toBe("#conversations/terminal/2");
		expect(await rows(view)).toEqual(["Terminal 1", "Terminal 2"]);
		expect(testing.shells[0]?.sent).toEqual([sized]);
	});
});
