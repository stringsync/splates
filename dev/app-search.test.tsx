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
			fireEvent.keyDown(window, { key: "k", metaKey: true }),
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

	it("opens a todo picked with Enter", async () => {
		const { view, box } = await searchFor("retry");

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(view.queryByRole("textbox", { name: "search" })).toBeNull(),
		);
		await waitFor(() => view.getByRole("dialog", { name: /Todo 7/ }));
	});

	it("opens a task picked", async () => {
		const { results } = await searchFor("upload-fix");

		await act(async () =>
			fireEvent.click(within(results).getByText("upload-fix")),
		);

		expect(location.hash).toBe("#tasks/upload-fix");
	});
});
