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
	let shot: File;

	beforeEach(async () => {
		testing = new Testing();
		shot = new File(["png bytes"], "shot.png", { type: "image/png" });
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
	const rows = () =>
		within(sidebar(view)).getAllByRole("button", {
			name: /New conversation/,
		});

	it("lists a new conversation in the sidebar once ⌥⌘N opens it, and keeps it there when left empty", async () => {
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
		expect(unstarted(view)?.getAttribute("aria-current")).toBeNull();
	});

	it("opens another draft on every shortcut and click, preserving earlier text and files", async () => {
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New" })),
		);
		const first = location.hash;

		await typeIn(box(view), "keep this");
		await act(async () =>
			fireEvent.paste(box(view), { clipboardData: { files: [shot] } }),
		);
		await waitFor(() => expect(textIn(box(view))).toContain("[Image 1]"));
		await pressNew();
		const second = location.hash;
		expect(second).not.toBe(first);
		expect(textIn(box(view))).toBe("");
		expect(rows()).toHaveLength(2);
		await typeIn(box(view), "second draft");
		const secondRow = rows().find(
			(row) => row.getAttribute("aria-current") === "page",
		) as HTMLElement;
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Pick an agent" })),
		);
		await clickShown(() => view.getByRole("menuitem", { name: /Codex/ }));
		expect(location.hash.split("?")[1]).toBe(second.split("?")[1]);
		expect(textIn(box(view))).toBe("second draft");
		await pressNew();
		expect(location.hash).not.toBe(second);
		expect(textIn(box(view))).toBe("");
		expect(rows()).toHaveLength(3);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "New" })),
		);
		expect(rows()).toHaveLength(4);
		await act(async () => fireEvent.click(secondRow));
		expect(textIn(box(view))).toBe("second draft");
		expect(
			view.getByRole("button", { name: "Pick an agent" }).textContent,
		).toContain("Codex");
		await act(async () => fireEvent.click(rows()[0] as HTMLElement));
		expect(location.hash).toBe("#conversations/new/claude");
		await waitFor(() =>
			expect(textIn(box(view))).toContain("keep this [Image 1]"),
		);
	});

	it("keeps a new conversation's words and files while away, to go back to from its row", async () => {
		await newWith(view, "Codex");

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
		await waitFor(() => expect(unstarted(view)).toBeNull());
	});

	it("throws a new conversation's draft away from its row", async () => {
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

	it("throws an empty new conversation away from its row", async () => {
		await newWith(view, "Claude");
		await openRow(view, "Fix login");

		await act(async () =>
			fireEvent.click(
				within(sidebar(view)).getByRole("button", { name: "Discard draft" }),
			),
		);

		expect(unstarted(view)).toBeNull();
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
