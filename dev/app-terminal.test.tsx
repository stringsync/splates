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

/** Ctrl+`, the chord that shows and hides the terminal. */
const TOGGLE = { key: "`", code: "Backquote", ctrlKey: true };

describe("App's terminal", () => {
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

	/** The Terminal action in the conversation's actions card. */
	const terminalAction = (view: Awaited<ReturnType<typeof reading>>) =>
		within(view.getByRole("navigation", { name: "actions" })).getByRole(
			"button",
			{ name: /Terminal/ },
		);

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

	it("shows no terminal until asked for", async () => {
		const view = await reading();

		expect(view.queryByRole("complementary", { name: "terminal" })).toBeNull();
		expect(testing.shells).toEqual([]);
	});

	it("opens the conversation's shell in a pane on Ctrl+`, and shows what it prints", async () => {
		const view = await reading();

		await press(TOGGLE);

		const pane = view.getByRole("complementary", { name: "terminal" });
		const [shell] = testing.shells;
		expect(shell?.task).toBeNull();
		expect(shell?.url).toMatch(/\/api\/terminal\?cols=\d+&rows=\d+$/);
		expect(within(pane).getByRole("status").textContent).toBe("Connecting");

		await act(async () => {
			shell?.accept();
			shell?.print("hello from the shell");
		});

		expect(shell?.sent).toEqual([sized]);
		await waitFor(() =>
			expect(view.getByTestId("terminal").textContent).toContain(
				"hello from the shell",
			),
		);
	});

	it("starts it in the task the conversation is in", async () => {
		await reading([conversation({ id: "c1", task: "alpha" })]);

		await press(TOGGLE);

		expect(testing.shells.map((shell) => shell.task)).toEqual(["alpha"]);
	});

	it("opens and hides from the actions card's Terminal too, and from the pane's own X", async () => {
		const view = await reading();

		await act(async () => fireEvent.click(terminalAction(view)));
		expect(view.getByRole("complementary", { name: "terminal" })).toBeTruthy();

		await act(async () => fireEvent.click(terminalAction(view)));
		expect(view.queryByRole("complementary", { name: "terminal" })).toBeNull();

		await act(async () => fireEvent.click(terminalAction(view)));
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Hide the terminal" })),
		);
		expect(view.queryByRole("complementary", { name: "terminal" })).toBeNull();
	});

	it("shares the pane with a task's changes, the one asked for last showing", async () => {
		const view = await reading([conversation({ id: "c1", task: "alpha" })]);
		await press(TOGGLE);

		await act(async () =>
			fireEvent.click(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: /Review changes/ },
				),
			),
		);
		expect(view.queryByRole("complementary", { name: "terminal" })).toBeNull();
		view.getByRole("complementary", { name: "changes in alpha" });

		await press(TOGGLE);
		expect(view.queryByRole("complementary", { name: /changes/ })).toBeNull();
		view.getByRole("complementary", { name: "terminal" });
		expect(testing.shells).toHaveLength(1);
	});

	it("hides on Ctrl+` from inside the terminal, keeping the shell, and the keyboard goes to the composer", async () => {
		const view = await reading();
		await press(TOGGLE);
		const [shell] = testing.shells;
		await act(async () => shell?.accept());
		const input = within(view.getByTestId("terminal")).getByRole("textbox");

		await press(TOGGLE, input);

		expect(view.queryByRole("complementary", { name: "terminal" })).toBeNull();
		expect(shell?.sent).toEqual([sized]);
		expect(shell?.readyState).toBe(1);
		expect(document.activeElement?.getAttribute("aria-label")).toBe(
			"Message input",
		);

		await press(TOGGLE);

		expect(testing.shells).toHaveLength(1);
	});

	it("sends what is typed to the shell", async () => {
		const view = await reading();
		await press(TOGGLE);
		const [shell] = testing.shells;
		await act(async () => shell?.accept());

		const input = within(view.getByTestId("terminal")).getByRole("textbox");
		await act(async () =>
			fireEvent.paste(input, { clipboardData: { getData: () => "ls\r" } }),
		);

		expect(shell?.sent).toEqual([sized, "ls\r"]);
	});

	it("hangs up on the shell, and shows no terminal, once the conversation is archived", async () => {
		const view = await reading();
		await press(TOGGLE);
		const [shell] = testing.shells;
		await act(async () => shell?.accept());

		await testing.say(
			conversation({ id: "c1", title: "Fix it", archived: true }),
		);

		expect(shell?.readyState).toBe(3);
		expect(view.queryByRole("complementary", { name: "terminal" })).toBeNull();
		expect(
			within(view.getByRole("navigation", { name: "actions" })).queryByRole(
				"button",
				{ name: /Terminal/ },
			),
		).toBeNull();
		expect(testing.shells).toHaveLength(1);
	});

	it("asks before archiving an idle conversation only while its shell is up", async () => {
		const view = await reading();
		const archived = () =>
			testing.posts.filter(
				(post) => post.path === "/api/conversations/c1/archived",
			);
		const archive = () =>
			act(async () =>
				fireEvent.click(
					within(view.getByRole("navigation", { name: "actions" })).getByRole(
						"button",
						{ name: /^Archive/ },
					),
				),
			);
		await press(TOGGLE);
		const [shell] = testing.shells;
		await act(async () => shell?.accept());

		await archive();
		const dialog = view.getByRole("dialog");
		expect(dialog.textContent).toContain("terminal is still open");
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })),
		);
		expect(archived()).toHaveLength(0);

		await act(async () => shell?.exit(0));
		await archive();

		expect(view.queryByRole("dialog")).toBeNull();
		expect(archived()).toHaveLength(1);
	});

	it("asks before archiving a stopped conversation whose shell is up", async () => {
		const view = await reading([
			conversation({ id: "c1", title: "Fix it", status: "stopped" }),
		]);
		await press(TOGGLE);
		await act(async () => testing.shells[0]?.accept());

		await act(async () =>
			fireEvent.click(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: /^Archive/ },
				),
			),
		);

		expect(view.getByRole("dialog").textContent).toContain(
			"Its terminal is still open. Archiving closes it.",
		);
	});

	it("stops the shell from the pane's Stop, so archiving asks nothing", async () => {
		const view = await reading();
		await press(TOGGLE);
		const [shell] = testing.shells;
		await act(async () => shell?.accept());

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Stop/ })),
		);

		expect(shell?.readyState).toBe(3);
		expect(view.queryByRole("complementary", { name: "terminal" })).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: /^Archive/ },
				),
			),
		);
		expect(view.queryByRole("dialog")).toBeNull();
	});

	it("shows the terminal from the archive dialog of a conversation whose shell is up", async () => {
		const view = await reading([
			conversation({ id: "c1", title: "One" }),
			conversation({ id: "c2", title: "Two" }),
		]);
		await press(TOGGLE);
		await act(async () => testing.shells[0]?.accept());
		await press(TOGGLE);
		await go("#conversations/c2");

		await act(async () =>
			fireEvent.click(
				within(view.getByRole("navigation", { name: "conversations" }))
					.getAllByRole("button", { name: /More/ })
					.at(0) as HTMLElement,
			),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: /Archive/ })),
		);
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("dialog")).getByRole("button", {
					name: "Show the terminal",
				}),
			),
		);

		expect(location.hash).toBe("#conversations/c1");
		view.getByRole("complementary", { name: "terminal" });
		expect(testing.shells).toHaveLength(1);
	});

	it("keeps each conversation's shell while another is up", async () => {
		await reading([
			conversation({ id: "c1", title: "One" }),
			conversation({ id: "c2", title: "Two", task: "alpha" }),
		]);
		await press(TOGGLE);

		await go("#conversations/c2");
		await go("#conversations/c1");

		expect(testing.shells.map((shell) => shell.task)).toEqual([null, "alpha"]);
		expect(testing.shells.map((shell) => shell.readyState)).toEqual([0, 0]);
	});

	it("takes the keyboard when shown, and leaves it to the composer of a conversation moved to", async () => {
		const view = await reading([
			conversation({ id: "c1", title: "One" }),
			conversation({ id: "c2", title: "Two" }),
		]);

		await press(TOGGLE);
		expect(document.activeElement).toBe(
			within(view.getByTestId("terminal")).getByRole("textbox"),
		);

		await go("#conversations/c2");

		expect(document.activeElement).not.toBe(
			within(view.getByTestId("terminal")).getByRole("textbox"),
		);
	});

	it("hides the pane once the shell exits, and starts another when shown again", async () => {
		const view = await reading();
		await press(TOGGLE);
		const [shell] = testing.shells;
		await act(async () => {
			shell?.accept();
			shell?.exit(3);
		});

		expect(view.queryByRole("complementary", { name: "terminal" })).toBeNull();
		expect(document.activeElement).toBe(
			view.getByRole("textbox", { name: "Message input" }),
		);
		expect(testing.shells).toHaveLength(1);

		await press(TOGGLE);

		expect(testing.shells).toHaveLength(2);
		expect(
			within(view.getByRole("complementary", { name: "terminal" })).getByRole(
				"status",
			).textContent,
		).toBe("Connecting");
	});

	it("drops the shell of a conversation not up once it exits, leaving the pane shown", async () => {
		const view = await reading([
			conversation({ id: "c1", title: "One" }),
			conversation({ id: "c2", title: "Two" }),
		]);
		await press(TOGGLE);
		const [shell] = testing.shells;
		await act(async () => shell?.accept());
		await go("#conversations/c2");
		await act(async () => testing.shells[1]?.accept());

		await act(async () => shell?.exit(0));

		expect(view.getByRole("complementary", { name: "terminal" })).toBeTruthy();
		await go("#conversations/c1");
		expect(testing.shells).toHaveLength(3);
	});

	it("offers a shell where the conversation moved to, once its agent took a task", async () => {
		const view = await reading();
		await press(TOGGLE);
		await act(async () => testing.shells[0]?.accept());
		expect(view.queryByRole("button", { name: "Restart" })).toBeNull();

		await testing.say(
			conversation({ id: "c1", title: "Fix it", task: "alpha" }),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Restart" })),
		);

		expect(testing.shells.map((shell) => shell.task)).toEqual([null, "alpha"]);
	});

	it("stays shown through a reload, running a fresh shell", async () => {
		await reading();
		await press(TOGGLE);
		cleanup();

		const view = await reading();

		expect(view.getByRole("complementary", { name: "terminal" })).toBeTruthy();
		expect(testing.shells).toHaveLength(2);
	});

	it("leaves ⌥⌘B to the browser", async () => {
		const view = await reading();

		await press({ key: "∫", code: "KeyB", altKey: true, metaKey: true });

		expect(view.queryByRole("complementary", { name: "terminal" })).toBeNull();
	});

	it("nests the shell under its conversation in the sidebar while it is up, opening it from there", async () => {
		const view = await reading();
		const nested = () =>
			within(view.getByRole("navigation", { name: "conversations" }))
				.queryByRole("list", { name: /^parts of / })
				?.querySelector("li");
		expect(nested()).toBeFalsy();

		await press(TOGGLE);
		const [shell] = testing.shells;
		await act(async () => shell?.accept());
		const row = within(nested() as HTMLElement).getByRole("button", {
			name: "Terminal",
		});
		expect(row.getAttribute("aria-current")).toBe("page");
		expect(row.querySelector(".italic")?.textContent).toBe("Terminal");

		await press(TOGGLE);
		expect(row.getAttribute("aria-current")).toBeNull();
		await act(async () => fireEvent.click(row));
		expect(view.getByRole("complementary", { name: "terminal" })).toBeTruthy();

		await act(async () => shell?.exit(0));
		expect(nested()).toBeFalsy();
	});

	it("renames the shell nested under its conversation, keeping the name for its next", async () => {
		const view = await reading();
		const sidebar = () =>
			within(view.getByRole("navigation", { name: "conversations" }));
		await press(TOGGLE);
		await act(async () => testing.shells[0]?.accept());

		await act(async () =>
			fireEvent.click(
				sidebar().getByRole("button", { name: "Rename Terminal" }),
			),
		);
		const box = sidebar().getByRole("textbox", { name: "Rename Terminal" });
		await act(async () => {
			fireEvent.change(box, { target: { value: "Server" } });
			fireEvent.keyDown(box, { key: "Enter" });
		});
		expect(sidebar().getByRole("button", { name: "Server" })).toBeTruthy();

		await act(async () => testing.shells[0]?.exit(0));
		await press(TOGGLE);
		await act(async () => testing.shells[1]?.accept());
		expect(sidebar().getByRole("button", { name: "Server" })).toBeTruthy();
	});

	it("leaves Escape alone to reach the shell", async () => {
		const view = await reading();
		await press(TOGGLE);
		const [shell] = testing.shells;
		await act(async () => shell?.accept());
		const input = within(view.getByTestId("terminal")).getByRole("textbox");

		await press({ key: "Escape", code: "Escape", keyCode: 27 }, input);

		expect(shell?.sent).toEqual([sized, "\x1b"]);
	});
});
