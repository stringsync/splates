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

describe("App's todo edits", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("renders a todo's detail as markdown, on its card and when opened", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 4, subject: "write docs", text: "start with **the CLI**" }),
			],
		});

		expect(view.getByText("the CLI").tagName).toBe("STRONG");
		await act(async () => fireEvent.click(view.getByText("write docs")));
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(within(dialog).getByText("the CLI").tagName).toBe("STRONG");
		expect(dialog.textContent).toContain("Markdown supported");
	});

	it("rewords one", async () => {
		const view = await testing.open({
			todos: [todo({ id: 4, subject: "write docs", text: "soon" })],
		});

		await act(async () => fireEvent.click(view.getByText("write docs")));
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "subject" }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "write the docs" } }),
		);
		// A todo with detail opens on its preview.
		expect(view.queryByRole("textbox", { name: "detail" })).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Write" })),
		);
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "detail" }), {
				target: { value: "" },
			}),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Save" })),
		);

		await waitFor(() => expect(testing.posts).toHaveLength(1));
		expect(testing.posts[0]).toMatchObject({
			path: "/api/todos/4",
			method: "PATCH",
		});
		const form = testing.posts[0]?.body as FormData;
		expect(form.get("subject")).toBe("write the docs");
		expect(form.get("text")).toBe("");
		// Not moved, so no place is sent to undo a move made elsewhere.
		expect(form.has("position")).toBe(false);
	});

	it("tags one from its dialog", async () => {
		const view = await testing.open({
			todos: [todo({ id: 4, subject: "write docs", tags: ["docs"] })],
		});

		await act(async () => fireEvent.click(view.getByText("write docs")));
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "tags" }),
		);
		expect((box as HTMLInputElement).value).toBe("docs");
		expect(box.getAttribute("aria-describedby")).toBeTruthy();
		expect(view.getByText("Separate tags with commas.")).toBeTruthy();
		await act(async () =>
			fireEvent.change(box, { target: { value: "docs, dev-page" } }),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Save" })),
		);

		await waitFor(() => expect(testing.posts).toHaveLength(1));
		const form = testing.posts[0]?.body as FormData;
		expect(form.get("tags")).toBe("docs,dev-page");
	});

	it("moves one to the top or bottom from its dialog", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({ id: 4, subject: "second", position: 2, tags: ["docs"] }),
				todo({ id: 6, subject: "third", position: 3 }),
			],
		});

		// Filtered to one tag, the bottom is still the whole list's.
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "docs 1" })),
		);
		await act(async () => fireEvent.click(view.getByText("second")));
		let dialog = await waitFor(() => view.getByRole("dialog"));
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Move to bottom" }),
			),
		);
		// Done with it, the way saving is.
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		await act(async () => fireEvent.click(view.getByText("second")));
		dialog = await waitFor(() => view.getByRole("dialog"));
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Move to top" }),
			),
		);
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());

		expect(testing.posts.map((post) => post.path)).toEqual([
			"/api/todos/4/position",
			"/api/todos/4/position",
		]);
		expect(testing.posts.map((post) => JSON.parse(String(post.body)))).toEqual([
			{ position: 3 },
			{ position: 1 },
		]);
	});

	it("opens the top todo and steps through the list from the keyboard", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({ id: 4, subject: "second", position: 2 }),
			],
		});
		const subject = () =>
			(view.getByRole("textbox", { name: "subject" }) as HTMLInputElement)
				.value;
		const press = (key: string) =>
			act(async () => fireEvent.keyDown(document.body, { key }));

		await press("o");
		await waitFor(() => expect(subject()).toBe("first"));
		await press("]");
		await waitFor(() => expect(subject()).toBe("second"));
		// Nothing below the bottom one.
		await press("]");
		expect(subject()).toBe("second");
		await press("[");
		await waitFor(() => expect(subject()).toBe("first"));
		// The one dialog all along, showing another todo.
		expect(view.getAllByRole("dialog")).toHaveLength(1);
		// A key typed into a field is only typing.
		await act(async () =>
			fireEvent.keyDown(view.getByRole("textbox", { name: "subject" }), {
				key: "]",
			}),
		);
		expect(subject()).toBe("first");
		expect(testing.posts).toHaveLength(0);
	});

	it("lists the keyboard shortcuts on ?", async () => {
		const view = await testing.open({
			todos: [todo({ id: 1, subject: "first" })],
		});

		await act(async () => fireEvent.keyDown(document.body, { key: "?" }));
		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Keyboard shortcuts" }),
		);
		expect(dialog.textContent).toContain("Open the top todo");
		// Its own keys stay quiet while it is up.
		await act(async () => fireEvent.keyDown(document.body, { key: "o" }));
		expect(view.queryByRole("textbox", { name: "subject" })).toBeNull();
	});

	it("saves what was typed before stepping to the next todo", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({ id: 4, subject: "second", position: 2 }),
			],
		});

		await act(async () => fireEvent.click(view.getByText("first")));
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "subject" }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "first, reworded" } }),
		);
		await act(async () => fireEvent.keyDown(document.body, { key: "]" }));

		await waitFor(() =>
			expect(
				(view.getByRole("textbox", { name: "subject" }) as HTMLInputElement)
					.value,
			).toBe("second"),
		);
		expect(testing.posts).toHaveLength(1);
		expect(testing.posts[0]).toMatchObject({
			path: "/api/todos/1",
			method: "PATCH",
		});
		const form = testing.posts[0]?.body as FormData;
		expect(form.get("subject")).toBe("first, reworded");
	});

	it("moves the open todo to the top or bottom from the keyboard", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({ id: 4, subject: "second", position: 2 }),
				todo({ id: 6, subject: "third", position: 3 }),
			],
		});

		await act(async () => fireEvent.click(view.getByText("second")));
		await waitFor(() => view.getByRole("dialog"));
		await act(async () => fireEvent.keyDown(document.body, { key: "{" }));
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		await act(async () => fireEvent.click(view.getByText("second")));
		await waitFor(() => view.getByRole("dialog"));
		await act(async () => fireEvent.keyDown(document.body, { key: "}" }));
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());

		expect(testing.posts.map((post) => JSON.parse(String(post.body)))).toEqual([
			{ position: 1 },
			{ position: 3 },
		]);
	});

	it("saves what was typed along with a move", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({ id: 4, subject: "second", position: 2 }),
			],
		});

		await act(async () => fireEvent.click(view.getByText("second")));
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "subject" }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "second, reworded" } }),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Move to top" })),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(testing.posts).toHaveLength(1);
		expect(testing.posts[0]).toMatchObject({
			path: "/api/todos/4",
			method: "PATCH",
		});
		const form = testing.posts[0]?.body as FormData;
		expect(form.get("subject")).toBe("second, reworded");
		expect(form.get("position")).toBe("1");
	});

	it("cannot move the top todo up or the bottom one down", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({ id: 4, subject: "second", position: 2 }),
			],
		});

		await act(async () => fireEvent.click(view.getByText("first")));
		let dialog = await waitFor(() => view.getByRole("dialog"));
		const top = within(dialog).getByRole("button", { name: "Move to top" });
		expect((top as HTMLButtonElement).disabled).toBe(true);
		await act(async () => fireEvent.keyDown(dialog, { key: "Escape" }));
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());

		await act(async () => fireEvent.click(view.getByText("second")));
		dialog = await waitFor(() => view.getByRole("dialog"));
		const bottom = within(dialog).getByRole("button", {
			name: "Move to bottom",
		});
		expect((bottom as HTMLButtonElement).disabled).toBe(true);
	});

	it("moves one up the list by its grip, from the keyboard", async () => {
		// happy-dom lays nothing out, and a drag goes by where things are: stack
		// the cards 50px apart so there is an above and a below.
		const rect = Element.prototype.getBoundingClientRect;
		Element.prototype.getBoundingClientRect = function (this: Element) {
			const card = this.closest("li");
			const at = card
				? [...(card.parentElement?.children ?? [])].indexOf(card)
				: 0;
			return DOMRect.fromRect({ x: 0, y: at * 50, width: 300, height: 40 });
		};
		try {
			const view = await testing.open({
				todos: [
					todo({ id: 1, subject: "first" }),
					todo({ id: 4, subject: "second", position: 2 }),
				],
			});

			const grip = view.getByRole("button", { name: "move second" });
			grip.focus();
			// Each key gets a moment for the drag to catch up before the next.
			const press = (code: string) =>
				act(async () => {
					fireEvent.keyDown(grip, { code });
					await new Promise((settle) => setTimeout(settle, 20));
				});
			await press("Space");
			await press("ArrowUp");
			await press("Space");

			await waitFor(() => expect(testing.posts).toHaveLength(1));
			expect(testing.posts[0]?.path).toBe("/api/todos/4/position");
			expect(testing.posts[0]?.method).toBe("PUT");
			expect(JSON.parse(String(testing.posts[0]?.body))).toEqual({
				position: 1,
			});
			// Where it was let go, before the server says so.
			expect(
				within(view.getByRole("list", { name: "todos" }))
					.getAllByRole("listitem")
					.map((card) => card.textContent),
			).toEqual([
				expect.stringContaining("second"),
				expect.stringContaining("first"),
			]);
		} finally {
			Element.prototype.getBoundingClientRect = rect;
		}
	});

	it("drops a file attached to one", async () => {
		const view = await testing.open({
			todos: [
				todo({
					id: 4,
					subject: "fix the chart",
					files: [
						"/repo/.git/arbor/todos/4/0-a.png",
						"/repo/.git/arbor/todos/4/1-b.log",
					],
				}),
			],
		});
		expect(
			view.getByRole("img", { name: "files" }).parentElement?.textContent,
		).toBe("2");

		await act(async () => fireEvent.click(view.getByText("fix the chart")));
		const save = await waitFor(() =>
			view.getByRole("button", { name: "Save" }),
		);
		expect((save as HTMLButtonElement).disabled).toBe(true);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "remove b.log" })),
		);
		await act(async () => fireEvent.click(save));

		await waitFor(() => expect(testing.posts).toHaveLength(1));
		expect(
			(testing.posts[0]?.body as FormData | undefined)?.getAll("keep"),
		).toEqual(["/repo/.git/arbor/todos/4/0-a.png"]);
	});

	it("removes one, asking twice", async () => {
		const view = await testing.open({
			todos: [todo({ id: 4, subject: "write docs" })],
		});

		await act(async () => fireEvent.click(view.getByText("write docs")));
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Remove" })),
			),
		);
		expect(testing.posts).toHaveLength(0);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Remove for good" })),
		);

		await waitFor(() => expect(testing.posts).toHaveLength(1));
		expect(testing.posts[0]).toMatchObject({
			path: "/api/todos/4",
			method: "DELETE",
		});
	});
});
