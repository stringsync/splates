import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	newestFirst,
	newWith,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's sidebar keys", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const ask = {
		type: "permission" as const,
		id: "t1",
		at: "2026-10-11T10:00:00.000Z",
		title: "rm -rf build",
		options: [{ id: "yes", name: "Allow", kind: "allow_once" as const }],
	};

	it("shows each key while ⌥⌘ is held, and opens a row with ⌥⌘ and its digit", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", title: "First" }),
				conversation({ id: "c2", title: "Second" }),
			]),
			null,
			{ tasks: [details({ task: "beta", status: "escalated" })] },
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		const keys = () =>
			[...nav.querySelectorAll("kbd")].map((each) => each.textContent);
		expect(keys()).toEqual([]);

		await act(async () =>
			fireEvent.keyDown(window, { key: "Alt", altKey: true, metaKey: true }),
		);
		expect(keys()).toEqual(["M", "0", "1", "2"]);
		expect(view.getByRole("button", { name: /^New/ }).textContent).toBe("NewN");
		await act(async () =>
			fireEvent.keyDown(document.body, {
				code: "Digit1",
				altKey: true,
				metaKey: true,
			}),
		);
		expect(location.hash).toBe("#conversations/c2");
		await act(async () =>
			fireEvent.keyDown(document.body, {
				code: "Digit2",
				altKey: true,
				ctrlKey: true,
			}),
		);
		expect(location.hash).toBe("#conversations/task/beta");

		await act(async () =>
			fireEvent.keyUp(window, { key: "Alt", metaKey: true }),
		);
		expect(keys()).toEqual([]);
	});

	it("opens the row below with ⌥⌘] and the one above with ⌥⌘[, round past either end", async () => {
		await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", title: "First" }),
				conversation({ id: "c2", title: "Second" }),
			]),
			null,
			{ tasks: [details({ task: "beta", status: "escalated" })] },
		);
		const press = (code: string) =>
			act(async () =>
				fireEvent.keyDown(document.body, {
					code,
					altKey: true,
					metaKey: true,
				}),
			);
		await press("BracketRight");
		expect(location.hash).toBe("#conversations/c1");
		await press("BracketRight");
		expect(location.hash).toBe("#conversations/c2");
		await press("BracketRight");
		expect(location.hash).toBe("#conversations/task/beta");
		await press("BracketRight");
		expect(location.hash).toBe("#conversations/c1");
		await press("BracketLeft");
		expect(location.hash).toBe("#conversations/task/beta");
	});

	it("skips archived conversations with ⌥⌘[ and ⌥⌘], including those archived in the last hour", async () => {
		const ago = (minutes: number) =>
			new Date(Date.now() - minutes * 60 * 1000).toISOString();
		await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", title: "First" }),
				conversation({
					id: "c2",
					title: "Lately",
					archived: true,
					archivedAt: ago(10),
				}),
				conversation({
					id: "c3",
					title: "Long ago",
					archived: true,
					archivedAt: ago(120),
				}),
				conversation({ id: "c4", title: "Last" }),
			]),
			"c4",
			{ tasks: [] },
		);
		const press = (code: string) =>
			act(async () =>
				fireEvent.keyDown(document.body, {
					code,
					altKey: true,
					metaKey: true,
				}),
			);
		await press("BracketLeft");
		expect(location.hash).toBe("#conversations/c1");
		await press("BracketLeft");
		expect(location.hash).toBe("#conversations/c4");
		await press("BracketRight");
		expect(location.hash).toBe("#conversations/c1");
		await press("BracketRight");
		expect(location.hash).toBe("#conversations/c4");
	});

	it("goes back through the conversations opened with ⌥⌘, and forward with ⌥⌘., leaving ⌘, to Settings", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", title: "First" }),
				conversation({ id: "c2", title: "Second" }),
				conversation({ id: "c3", title: "Third" }),
			]),
			null,
		);
		const press = (code: string, ctrl = false) =>
			act(async () =>
				fireEvent.keyDown(document.body, {
					code,
					key: ",",
					altKey: true,
					metaKey: !ctrl,
					ctrlKey: ctrl,
				}),
			);
		await press("BracketRight");
		await press("BracketRight");
		await press("BracketRight");
		expect(location.hash).toBe("#conversations/c3");

		await press("Comma");
		expect(location.hash).toBe("#conversations/c2");
		await press("Comma", true);
		expect(location.hash).toBe("#conversations/c1");
		await press("Comma");
		expect(location.hash).toBe("#conversations/c1");
		expect(view.queryByRole("dialog", { name: "Settings" })).toBeNull();

		await press("Period");
		expect(location.hash).toBe("#conversations/c2");
		await press("Period");
		expect(location.hash).toBe("#conversations/c3");
		await press("Period");
		expect(location.hash).toBe("#conversations/c3");

		await press("Comma");
		await press("Digit0");
		expect(location.hash).toBe("#conversations/c1");
		await press("Period");
		expect(location.hash).toBe("#conversations/c1");
		await press("Comma");
		expect(location.hash).toBe("#conversations/c2");
	});

	it("opens Todos with ⌥⌘T, showing a tab's key while ⌥⌘ is held", async () => {
		const view = await testing.openConversations(
			newestFirst([conversation({ id: "c1", title: "First" })]),
			null,
		);
		const tab = (name: RegExp) => view.getByRole("tab", { name });
		const key = (name: RegExp) =>
			tab(name).querySelector("kbd")?.textContent ?? null;
		expect(key(/Todos/)).toBeNull();

		await act(async () =>
			fireEvent.keyDown(window, { key: "Alt", altKey: true, metaKey: true }),
		);
		expect(key(/Todos/)).toBe("T");
		expect(key(/Conversations/)).toBeNull();
		expect(key(/Tasks/)).toBeNull();

		await act(async () =>
			fireEvent.keyDown(document.body, {
				code: "KeyT",
				altKey: true,
				metaKey: true,
			}),
		);
		expect(tab(/Todos/).getAttribute("aria-selected")).toBe("true");
		await act(async () =>
			fireEvent.keyUp(window, { key: "Alt", metaKey: true }),
		);
		expect(key(/Todos/)).toBeNull();
	});

	it("starts a new conversation with ⌥⌘N, with the agent and model the last one started with", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({
					id: "c1",
					agent: "codex",
					title: "Latest",
					settings: [
						{
							id: "model",
							name: "Model",
							type: "select",
							category: "model",
							current: "small",
							options: [
								{ value: "big", name: "Big", description: null },
								{ value: "small", name: "Small", description: null },
							],
						},
					],
				}),
				conversation({ id: "c2", title: "Earlier", status: "running", ask }),
			]),
			null,
		);

		await act(async () =>
			fireEvent.keyDown(document.body, {
				altKey: true,
				metaKey: true,
				code: "KeyN",
			}),
		);
		expect(location.hash).toBe("#conversations/new");
		expect(
			within(
				view.getByText("Start a conversation with")
					.parentElement as HTMLElement,
			).getByLabelText("Codex"),
		).toBeTruthy();
		expect(view.getByRole("combobox", { name: "model" }).textContent).toContain(
			"Small",
		);
	});

	it("shows ⌥⌘N in the New menu beside the agent it starts", async () => {
		const view = await testing.openConversations(
			newestFirst([
				conversation({ id: "c1", agent: "codex", title: "Latest" }),
				conversation({ id: "c2", title: "Earlier" }),
			]),
			null,
		);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New" })),
		);
		const item = (name: string) =>
			waitFor(() => view.getByRole("menuitem", { name: new RegExp(name) }));
		expect((await item("Codex")).textContent).toContain("⌥⌘N");
		expect((await item("Claude")).textContent).not.toContain("⌥⌘N");
	});

	it("focuses the composer of the agent picked from New, the one shown too", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Latest" })],
			null,
		);
		const composer = () =>
			within(view.getByRole("region", { name: "new conversation" })).getByRole(
				"textbox",
				{ name: "Message input" },
			);

		// Picked twice: the second time, the conversation is already open.
		const pick = async () => {
			view.getByRole("button", { name: "New" }).focus();
			await newWith(view, "Codex");
			return {
				// Not the element, whose printout on a failure overwhelms Bun.
				focused: document.activeElement === composer(),
				shown:
					within(
						view.getByText("Start a conversation with")
							.parentElement as HTMLElement,
					).queryByLabelText("Codex") !== null,
			};
		};
		const picked = { focused: true, shown: true };
		expect([await pick(), await pick()]).toEqual([picked, picked]);
	});
});
