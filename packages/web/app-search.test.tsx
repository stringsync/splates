import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's search", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.talk = {
			agents: [],
			conversations: [conversation({ id: "c1", name: "Upload chat" })],
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		history.replaceState(null, "", " ");
	});

	async function searchFor(words: string) {
		const view = await testing.open({
			tasks: [details({ task: "upload-fix" })],
			todos: [todo({ id: 7, subject: "Retry the upload" })],
		});
		await act(async () =>
			fireEvent.keyDown(window, { key: "k", code: "KeyK", metaKey: true }),
		);
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "search" }),
		);
		await act(async () => fireEvent.change(box, { target: { value: words } }));
		return { view, box, results: view.getByRole("list", { name: "results" }) };
	}

	it("finds tasks, conversations and todos on ⌘K", async () => {
		const { results } = await searchFor("upload");

		await waitFor(() => {
			expect(within(results).getByText("upload-fix")).toBeTruthy();
			expect(within(results).getByText("Upload chat")).toBeTruthy();
			expect(within(results).getByText("Retry the upload")).toBeTruthy();
		});
	});

	it("finds a todo by the start of its number", async () => {
		const { results } = await searchFor("#7");
		await waitFor(() =>
			expect(within(results).getByText("Retry the upload")).toBeTruthy(),
		);
	});

	it("finds a finished task by a number it took up", async () => {
		testing.finished = [
			{
				key: "5-1760000000000",
				id: 5,
				task: "finished-upload",
				subject: "Finished upload",
				ended: "merged",
				reason: null,
				base: "main",
				commit: "abc1234",
				startedAt: "2026-11-01T00:00:00Z",
				endedAt: "2026-11-01T01:00:00Z",
				conversation: null,
				took: [{ id: 1200, subject: "Queued retry" }],
				hasDemo: false,
				plan: "",
			},
		];
		const { results } = await searchFor("12");
		await waitFor(() =>
			expect(within(results).getByText("finished-upload")).toBeTruthy(),
		);
	});

	it("finds a conversation by its words, which the server searches", async () => {
		testing.talk = {
			agents: [],
			conversations: [
				conversation({
					id: "c2",
					name: "Chat",
					messages: [
						{
							role: "user",
							parts: [{ type: "text", text: "Why does the deploy hang?" }],
							plan: null,
							at: null,
							until: null,
						},
					],
				}),
			],
		};
		const { results } = await searchFor("hang");
		// Asked once typing pauses.
		await act(async () => testing.timer.fireTimeouts());

		await waitFor(() => {
			expect(within(results).getByText("Chat")).toBeTruthy();
			expect(
				within(results).getByText("Why does the deploy hang?"),
			).toBeTruthy();
		});
	});

	it("opens a todo picked with Enter", async () => {
		const { view, box } = await searchFor("retry");

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(view.queryByRole("textbox", { name: "search" })).toBeNull(),
		);
		await waitFor(() => view.getByRole("dialog", { name: /Task 7/ }));
	});

	it("opens a task picked", async () => {
		const { results } = await searchFor("upload-fix");

		await act(async () =>
			fireEvent.click(within(results).getByText("upload-fix")),
		);

		expect(location.hash).toBe("#tasks/upload-fix");
	});
});
