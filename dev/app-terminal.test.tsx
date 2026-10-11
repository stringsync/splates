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
			agents: [{ id: "claude", name: "Claude" }],
			conversations: held,
		};
		const view = await testing.open({ tasks: [details({ task: "alpha" })] });
		await go(`#conversations/${id}`);
		await waitFor(() => view.getByRole("navigation", { name: "overview" }));
		return view;
	};

	/** The Terminal action in the conversation's Overview card. */
	const terminalAction = (view: Awaited<ReturnType<typeof reading>>) =>
		within(view.getByRole("navigation", { name: "overview" })).getByRole(
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

	it("opens and hides from the Overview card's Terminal too, and from the pane's own X", async () => {
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
				within(view.getByRole("navigation", { name: "overview" })).getByRole(
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
		expect(document.activeElement?.tagName).toBe("TEXTAREA");

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
			within(view.getByRole("navigation", { name: "overview" })).queryByRole(
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
					within(view.getByRole("navigation", { name: "overview" })).getByRole(
						"button",
						{ name: "Archive" },
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

	it("says how the shell exited, and starts another on Restart", async () => {
		const view = await reading();
		await press(TOGGLE);
		const [shell] = testing.shells;
		await act(async () => {
			shell?.accept();
			shell?.exit(3);
		});

		expect(view.getByText("Exited with 3")).toBeTruthy();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Restart" })),
		);

		expect(testing.shells).toHaveLength(2);
		expect(view.queryByText("Exited with 3")).toBeNull();
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
