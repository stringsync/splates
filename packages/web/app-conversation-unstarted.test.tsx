import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	clickShown,
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
	let view: ConversationsView;

	beforeEach(async () => {
		testing = new Testing();
		view = await testing.openConversations(held, "c1");
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

	const pressNew = () =>
		act(async () =>
			fireEvent.keyDown(box(view), {
				altKey: true,
				metaKey: true,
				code: "KeyN",
			}),
		);

	it("lists no row in the sidebar for a new conversation, open or left empty", async () => {
		await pressNew();
		expect(location.hash).toStartWith("#conversations/new");
		expect(unstarted(view)).toBeNull();
		await openRow(view, "Tidy tests");
		expect(unstarted(view)).toBeNull();
	});

	it("opens the new conversation already there on every shortcut and click, keeping its text and files", async () => {
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New" })),
		);
		const first = location.hash;
		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });

		await typeIn(box(view), "keep this");
		await act(async () =>
			fireEvent.paste(box(view), { clipboardData: { files: [shot] } }),
		);
		await waitFor(() => expect(textIn(box(view))).toContain("[Image 1]"));
		await openRow(view, "Tidy tests");
		await pressNew();
		expect(location.hash).toStartWith(first);
		await waitFor(() =>
			expect(textIn(box(view))).toContain("keep this [Image 1]"),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New" })),
		);
		expect(location.hash).toStartWith(first);
		expect(location.hash).not.toContain("draft=");
	});

	it("opens the empty new conversation again rather than another", async () => {
		await pressNew();
		await openRow(view, "Tidy tests");
		await pressNew();
		expect(location.hash).toStartWith("#conversations/new");
		expect(location.hash).not.toContain("draft=");
	});

	it("picks another agent, or a terminal, from a new conversation's bar beside a sidebar, what was typed carried over", async () => {
		await newWith(view, "Claude");
		await typeIn(box(view), "carry me");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Pick an agent" })),
		);
		await clickShown(() => view.getByRole("menuitem", { name: /Codex/ }));

		expect(location.hash).toBe("#conversations/new/codex");
		expect(
			view.getByRole("button", { name: "Pick an agent" }).textContent,
		).toContain("Codex");
		await waitFor(() => expect(textIn(box(view))).toBe("carry me"));

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Pick an agent" })),
		);
		await clickShown(() => view.getByRole("menuitem", { name: "Terminal" }));
		expect(location.hash).toBe("#conversations/terminal/1");
	});
});
