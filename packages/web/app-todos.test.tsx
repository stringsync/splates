import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's todos", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("lists todos as cards with a preview and badges, leaving out where they came from", async () => {
		const view = await testing.open({
			todos: [
				todo({
					id: 1,
					subject: "fresh",
					from: "alpha",
					text: "more to say",
					files: ["/tmp/a.png", "/tmp/b.log"],
				}),
				todo({
					id: 2,
					subject: "ancient",
					position: 2,
					createdAt: "2020-01-01T00:00:00Z",
				}),
				todo({ id: 3, subject: "taken", position: 3, takenBy: "beta" }),
			],
		});

		expect(document.body.textContent).not.toContain("alpha");
		const cards = within(view.getByRole("list", { name: "Untriaged tasks" }))
			.getAllByRole("listitem")
			.map((card) => card.textContent);
		expect(cards[0]).toContain("more to say");
		expect(cards[0]).toContain("#1");
		expect(
			view.getByRole("img", { name: "files" }).parentElement?.textContent,
		).toBe("2");
		expect(view.getAllByRole("img", { name: "stale" })).toHaveLength(1);
	});

	it("says an untriaged one is untriaged in its dialog, not a step of a sequence", async () => {
		const view = await testing.open({
			todos: [todo({ id: 1, subject: "loose" })],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^loose/ })),
		);
		await waitFor(() => view.getByRole("dialog", { description: "Untriaged" }));
	});

	it("copies a link to one, without opening it", async () => {
		const copied: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void copied.push(text) },
		});
		const view = await testing.open({
			todos: [todo({ id: 7, subject: "fix it" })],
		});

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "copy a link to task 7" }),
			),
		);

		expect(copied).toEqual(["[SPLATES TASK #7]"]);
		expect(view.queryByText("Task 7")).toBeNull();
		// The id says so in place, with no toast.
		expect(
			view.getByRole("button", { name: "copy a link to task 7" }).textContent,
		).toBe("Copied");
		expect(view.queryByText("Copied [SPLATES TASK #7]")).toBeNull();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "fix it" })),
		);
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: /Task 7/ }),
		);
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "copy a link to task 7" }),
			),
		);
		expect(copied).toEqual(["[SPLATES TASK #7]", "[SPLATES TASK #7]"]);
	});

	it("adds one at the foot of a column, Trello style, staying open for the next", async () => {
		const view = await testing.open({
			lanes: [{ id: 4, name: "Docs" }],
			todos: [todo({ id: 1, subject: "first", lane: 4 })],
		});

		const docs = view.getByRole("region", { name: "Docs" });
		await act(async () =>
			fireEvent.click(within(docs).getByRole("button", { name: "Add a task" })),
		);
		const input = view.getByRole("textbox", { name: "new task" });
		await act(async () =>
			fireEvent.change(input, { target: { value: "write the docs" } }),
		);
		await act(async () => fireEvent.keyDown(input, { key: "Enter" }));

		await waitFor(() => expect(testing.posts).toHaveLength(1));
		expect(testing.posts[0]?.path).toBe("/api/todos");
		const form = testing.posts[0]?.body as FormData;
		expect(form.get("subject")).toBe("write the docs");
		expect(form.get("lane")).toBe("4");
		expect(form.has("position")).toBe(false);
		expect(form.getAll("file")).toEqual([]);
		// Still open, empty, for the next; Escape puts it away.
		await waitFor(() =>
			expect(
				(view.getByRole("textbox", { name: "new task" }) as HTMLTextAreaElement)
					.value,
			).toBe(""),
		);
		await act(async () =>
			fireEvent.keyDown(view.getByRole("textbox", { name: "new task" }), {
				key: "Escape",
			}),
		);
		expect(view.queryByRole("textbox", { name: "new task" })).toBeNull();
	});

	it("adds an untriaged one with no lane", async () => {
		const view = await testing.open();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add a task" })),
		);
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "new task" }), {
				target: { value: "later" },
			}),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add task" })),
		);

		await waitFor(() => expect(testing.posts).toHaveLength(1));
		const form = testing.posts[0]?.body as FormData;
		expect(form.has("lane")).toBe(false);
	});
});
