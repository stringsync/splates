import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
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
	const paste = (view: ConversationsView, file: File) =>
		act(async () =>
			fireEvent.paste(box(view), { clipboardData: { files: [file] } }),
		);
	const shot = new File(["png bytes"], "shot.png", { type: "image/png" });
	const clip = new File(["mp4 bytes"], "clip.mp4", { type: "video/mp4" });

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

	it("keeps a draft's files across a reload, in a conversation and a new one", async () => {
		const view = await testing.openConversations(held, "c1");
		await type(view, "see");
		await paste(view, shot);
		await waitFor(() => expect(textIn(box(view))).toBe("see [Image 1] "));
		await newWith(view, "Claude");
		await type(view, "and");
		await paste(view, clip);
		await waitFor(() => expect(textIn(box(view))).toBe("and [File 1] "));
		cleanup();
		testing.draftFiles.hold = true;

		const again = await testing.openConversations(held, "c1");
		await waitFor(() => expect(textIn(box(again))).toBe("see [Image 1] "));
		await act(async () => {
			testing.draftFiles.release();
			await Bun.sleep(0);
		});
		await act(async () => fireEvent.keyDown(box(again), { key: "Enter" }));
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "see [Image 1]", file: [shot] } },
			]),
		);
		await newWith(again, "Claude");
		await waitFor(() => expect(textIn(box(again))).toBe("and [File 1] "));
		testing.reply = conversation({ id: "c9", task: null, status: "starting" });
		await act(async () => fireEvent.keyDown(box(again), { key: "Enter" }));
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c9/prompt")).toEqual([
				{ method: "POST", body: { text: "and [File 1]", file: [clip] } },
			]),
		);
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
		await type(view, "keep [SPLATES TASK #12] small");

		await waitFor(() =>
			expect(within(box(view)).getByTitle("[SPLATES TASK #12]")).toBeTruthy(),
		);
		expect(textIn(box(view))).toBe("keep [SPLATES TASK #12] small");
		expect(localStorage.getItem("splates.draft.c1")).toBe(
			"keep [SPLATES TASK #12] small",
		);

		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "keep [SPLATES TASK #12] small" } },
		]);
		// Out of the composer; the thread shows it in the message sent.
		await waitFor(() =>
			expect(within(box(view)).queryByTitle("[SPLATES TASK #12]")).toBeNull(),
		);
		expect(localStorage.getItem("splates.draft.c1") ?? "").toBe("");
	});

	it("shows the directives a sent message starts with as chips, ahead of its words", async () => {
		const view = await testing.openConversations([
			conversation({
				id: "c1",
				title: "Fix login",
				messages: [
					message("user", "[SPLATES TASK alpha]\n\nand keep it small"),
				],
			}),
		]);

		await waitFor(() =>
			expect(view.getByTitle("[SPLATES TASK alpha]").textContent).toBe(
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
					message(
						"user",
						"then [SPLATES LANE 2] here, not `[SPLATES TASK alpha]`",
					),
				],
			}),
		]);

		const chip = await waitFor(() => view.getByTitle("[SPLATES LANE 2]"));
		expect(chip.textContent).toBe("Lane 2");
		expect(chip.parentElement?.textContent).toBe(
			"then Lane 2 here, not [SPLATES TASK alpha]",
		);
		expect(view.queryByTitle("[SPLATES TASK alpha]")).toBeNull();
	});

	it("sends a directive kept in a draft with nothing typed", async () => {
		localStorage.setItem("splates.draft.c1", "[SPLATES TASK alpha]");
		const view = await testing.openConversations(held, "c1");
		await waitFor(() =>
			expect(view.getByTitle("[SPLATES TASK alpha]").textContent).toBe(
				"Taskalpha",
			),
		);
		expect(textIn(box(view))).toBe("[SPLATES TASK alpha]");

		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[SPLATES TASK alpha]" } },
		]);
	});

	it("drops a directive from the draft when Backspace takes its chip", async () => {
		const view = await testing.openConversations(held, "c1");
		await type(view, "then stop [SPLATES LANE 2]");
		await waitFor(() =>
			expect(within(box(view)).getByTitle("[SPLATES LANE 2]")).toBeTruthy(),
		);

		await act(async () => fireEvent.keyDown(box(view), { key: "Backspace" }));

		expect(view.queryByTitle("[SPLATES LANE 2]")).toBeNull();
		expect(textIn(box(view))).toBe("then stop ");
		expect(localStorage.getItem("splates.draft.c1")).toBe("then stop ");
	});

	it("puts a message the server refused back in the composer on Edit, after what is typed there", async () => {
		const view = await testing.openConversations(held, "c1");
		testing.refuseWrites = { reason: "usage", message: "not now" };
		await type(view, "try this");
		await act(async () => fireEvent.keyDown(box(view), { key: "Enter" }));
		const edit = await waitFor(() =>
			view.getByRole("button", { name: "Edit" }),
		);
		await type(view, "first");

		await act(async () => fireEvent.click(edit));

		expect(textIn(box(view))).toBe("first\n\ntry this");
		expect(view.queryByText("Couldn't send")).toBeNull();
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
		const note = () =>
			within(view.getByRole("listitem", { name: "question 1" })).getByRole(
				"textbox",
			);
		await typeIn(note(), "the second one");

		await openRow(view, "Tidy tests");
		await openRow(view, "Fix login");

		expect(textIn(note())).toBe("the second one");
	});
});
