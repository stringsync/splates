import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "../conversations";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	message,
	newWith,
	openRow,
	Testing,
	textIn,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's composer drafts", () => {
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
		view.getByRole("textbox", {
			name: "Message input",
		});
	const type = (view: ConversationsView, text: string) =>
		typeIn(box(view), text);

	it("keeps what was typed in each conversation, and a new one, while switching", async () => {
		const view = await testing.openConversations(held, "c1");
		await type(view, "half a thought");

		await openRow(view, "Tidy tests");
		await waitFor(() => expect(textIn(box(view))).toBe(""));
		await type(view, "another");
		await newWith(view, "Claude");
		await waitFor(() => expect(textIn(box(view))).toBe(""));
		await type(view, "a fresh start");

		await openRow(view, "Fix login");
		await waitFor(() => expect(textIn(box(view))).toBe("half a thought"));
		await openRow(view, "Tidy tests");
		await waitFor(() => expect(textIn(box(view))).toBe("another"));
		await newWith(view, "Claude");
		await waitFor(() => expect(textIn(box(view))).toBe("a fresh start"));
	});

	it("keeps a draft across a reload, and drops it once sent", async () => {
		const view = await testing.openConversations(held, "c1");
		await type(view, "before the reload");
		cleanup();

		const again = await testing.openConversations(held, "c1");
		await waitFor(() => expect(textIn(box(again))).toBe("before the reload"));
		await act(async () => fireEvent.keyDown(box(again), { key: "Enter" }));
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "before the reload" } },
		]);
		await openRow(again, "Tidy tests");
		await openRow(again, "Fix login");
		await waitFor(() => expect(textIn(box(again))).toBe(""));
	});

	it("makes a directive typed anywhere a chip, and sends it where it stands", async () => {
		const view = await testing.openConversations(held, "c1");
		await type(view, "keep [ARBOR TODO #12] small");

		await waitFor(() =>
			expect(within(box(view)).getByTitle("[ARBOR TODO #12]")).toBeTruthy(),
		);
		expect(textIn(box(view))).toBe("keep [ARBOR TODO #12] small");
		expect(localStorage.getItem("arbor.draft.c1")).toBe(
			"keep [ARBOR TODO #12] small",
		);

		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "keep [ARBOR TODO #12] small" } },
		]);
		await waitFor(() =>
			expect(view.queryByTitle("[ARBOR TODO #12]")).toBeNull(),
		);
		expect(localStorage.getItem("arbor.draft.c1") ?? "").toBe("");
	});

	it("shows the directives a sent message starts with as chips, ahead of its words", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Fix login",
				messages: [message("user", "[ARBOR TASK alpha]\n\nand keep it small")],
			}),
		]);

		await waitFor(() =>
			expect(view.getByTitle("[ARBOR TASK alpha]").textContent).toBe(
				"Taskalpha",
			),
		);
		expect(view.getByText("and keep it small")).toBeTruthy();
	});

	it("shows a directive mid-message as a chip where it stands, and one in code as written", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Fix login",
				messages: [
					message("user", "then [ARBOR LANE 2] here, not `[ARBOR TASK alpha]`"),
				],
			}),
		]);

		const chip = await waitFor(() => view.getByTitle("[ARBOR LANE 2]"));
		expect(chip.textContent).toBe("Lane 2");
		expect(chip.parentElement?.textContent).toBe(
			"then Lane 2 here, not [ARBOR TASK alpha]",
		);
		expect(view.queryByTitle("[ARBOR TASK alpha]")).toBeNull();
	});

	it("sends a directive kept in a draft with nothing typed", async () => {
		localStorage.setItem("arbor.draft.c1", "[ARBOR TASK alpha]");
		const view = await testing.openConversations(held, "c1");
		await waitFor(() =>
			expect(view.getByTitle("[ARBOR TASK alpha]").textContent).toBe(
				"Taskalpha",
			),
		);
		expect(textIn(box(view))).toBe("[ARBOR TASK alpha]");

		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[ARBOR TASK alpha]" } },
		]);
	});

	it("drops a directive from the draft when Backspace takes its chip", async () => {
		const view = await testing.openConversations(held, "c1");
		await type(view, "then stop [ARBOR LANE 2]");
		await waitFor(() =>
			expect(within(box(view)).getByTitle("[ARBOR LANE 2]")).toBeTruthy(),
		);

		await act(async () => fireEvent.keyDown(box(view), { key: "Backspace" }));

		expect(view.queryByTitle("[ARBOR LANE 2]")).toBeNull();
		expect(textIn(box(view))).toBe("then stop ");
		expect(localStorage.getItem("arbor.draft.c1")).toBe("then stop ");
	});

	it("puts a message back in the composer when the server refuses it", async () => {
		const view = await testing.openConversations(held, "c1");
		testing.refuseWrites = { reason: "usage", message: "not now" };
		await type(view, "try this");

		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));

		await waitFor(() => expect(textIn(box(view))).toBe("try this"));
	});

	it("keeps what was typed into a question's box while away", async () => {
		const asking = conversation({
			id: "c1",
			title: "Fix login",
			status: "running",
			ask: {
				type: "question",
				id: "q1",
				at: "2026-10-11T10:00:00.000Z",
				message: "Which note?",
				fields: [
					{ key: "note", title: "Note", description: null, choices: null },
				],
			},
		});
		const view = await testing.openConversations(
			[asking, held[1] as ConversationState],
			"c1",
		);
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "Note" }), {
				target: { value: "the second one" },
			}),
		);

		await openRow(view, "Tidy tests");
		await openRow(view, "Fix login");

		expect(
			(view.getByRole("textbox", { name: "Note" }) as HTMLInputElement).value,
		).toBe("the second one");
	});
});
