import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	newWith,
	openRow,
	Testing,
	textIn,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's new conversations not started yet", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const held = [
		conversation({ id: "c1", title: "Fix login" }),
		conversation({ id: "c2", title: "Tidy tests" }),
	];
	const box = (view: ConversationsView) =>
		view.getByRole("textbox", { name: "Message input" });
	const sidebar = (view: ConversationsView) =>
		view.getByRole("navigation", { name: "conversations" });
	const unstarted = (view: ConversationsView) =>
		within(sidebar(view)).queryByRole("button", { name: /New conversation/ });

	it("lists a new conversation in the sidebar once ⌥⌘N opens it, until it is left empty", async () => {
		const view = await testing.openConversations(held, "c1");
		expect(unstarted(view)).toBeNull();

		await act(async () =>
			fireEvent.keyDown(document.body, {
				altKey: true,
				metaKey: true,
				code: "KeyN",
			}),
		);

		const row = unstarted(view);
		expect(row?.getAttribute("aria-current")).toBe("page");
		expect(row?.querySelector(".italic")?.textContent).toBe("New conversation");
		await openRow(view, "Tidy tests");
		expect(unstarted(view)).toBeNull();
	});

	it("keeps a new conversation's words and files while away, to go back to from its row", async () => {
		const view = await testing.openConversations(held, "c1");
		await newWith(view, "Codex");
		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });
		await act(async () =>
			fireEvent.paste(box(view), { clipboardData: { files: [shot] } }),
		);
		await typeIn(box(view), "look at this");

		await openRow(view, "Fix login");
		const row = unstarted(view);
		expect(row?.getAttribute("aria-current")).toBeNull();
		await act(async () => fireEvent.click(row as HTMLElement));

		expect(location.hash).toBe("#conversations/new/codex");
		await waitFor(() => expect(textIn(box(view))).toBe("look at this"));
		testing.reply = conversation({
			id: "c9",
			agent: "codex",
			task: null,
			status: "starting",
		});
		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c9/prompt")).toEqual([
				{ method: "POST", body: { text: "look at this", file: [shot] } },
			]),
		);
	});

	it("throws a new conversation's draft away from its row", async () => {
		const view = await testing.openConversations(held, "c1");
		await newWith(view, "Claude");
		await typeIn(box(view), "never mind");
		await openRow(view, "Fix login");

		await act(async () =>
			fireEvent.click(
				within(sidebar(view)).getByRole("button", { name: "Discard draft" }),
			),
		);

		expect(unstarted(view)).toBeNull();
		await newWith(view, "Claude");
		await waitFor(() => expect(textIn(box(view))).toBe(""));
	});

	it("picks another agent, or a terminal, from a new conversation's bar beside a sidebar, what was typed carried over", async () => {
		const view = await testing.openConversations(held, null);
		await newWith(view, "Claude");
		await typeIn(box(view), "carry me");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Pick an agent" })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: /Codex/ })),
			),
		);

		expect(location.hash).toBe("#conversations/new/codex");
		expect(
			view.getByRole("button", { name: "Pick an agent" }).textContent,
		).toContain("Codex");
		await waitFor(() => expect(textIn(box(view))).toBe("carry me"));

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Pick an agent" })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: "Terminal" })),
			),
		);
		expect(location.hash).toBe("#conversations/terminal/1");
	});
});
