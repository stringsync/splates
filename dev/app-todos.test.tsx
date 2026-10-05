import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	details,
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
		const cards = within(view.getByRole("list", { name: "todos" }))
			.getAllByRole("listitem")
			.map((card) => card.textContent);
		expect(cards[0]).toContain("more to say");
		expect(cards[0]).toContain("#1");
		expect(
			view.getByRole("img", { name: "files" }).parentElement?.textContent,
		).toBe("2");
		expect(view.getAllByRole("img", { name: "stale" })).toHaveLength(1);
		expect(view.getByRole("img", { name: "taken by" })).toBeTruthy();
		expect(cards[2]).toContain("Taken by beta");
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
				view.getByRole("button", { name: "copy a link to todo 7" }),
			),
		);

		expect(copied).toEqual(["[ARBOR TODO #7]"]);
		expect(view.queryByText("Todo 7")).toBeNull();
		expect(view.getByText("Copied [ARBOR TODO #7]")).toBeTruthy();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "fix it" })),
		);
		// The toast is a dialog too.
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: /Todo 7/ }),
		);
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "copy a link to todo 7" }),
			),
		);
		expect(copied).toEqual(["[ARBOR TODO #7]", "[ARBOR TODO #7]"]);
	});

	it("opens the task that took one, without opening the todo", async () => {
		const view = await testing.open({
			todos: [todo({ id: 3, subject: "taken", takenBy: "beta" })],
			tasks: [
				details({
					task: "beta",
					plan: "# beta\n\n## Goal\n\nship the thing\n",
				}),
			],
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Taken by beta/ })),
		);

		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(dialog.textContent).toContain("ship the thing");
		expect(view.queryByText("Todo 3")).toBeNull();
	});

	it("adds one", async () => {
		const view = await testing.open();

		const input = view.getByRole("textbox", { name: "new todo" });
		await act(async () =>
			fireEvent.change(input, { target: { value: "write the docs" } }),
		);
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "new todo detail" }), {
				target: { value: "the CLI first" },
			}),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add" })),
		);

		await waitFor(() => expect(testing.posts).toHaveLength(1));
		expect(testing.posts[0]?.path).toBe("/api/todos");
		const form = testing.posts[0]?.body as FormData;
		expect(form.get("subject")).toBe("write the docs");
		expect(form.get("text")).toBe("the CLI first");
		expect(form.has("position")).toBe(false);
		expect(form.getAll("file")).toEqual([]);
	});
});
