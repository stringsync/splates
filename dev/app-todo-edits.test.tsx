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
		// A todo with detail opens rendered, and a click on it writes it.
		expect(view.queryByRole("textbox", { name: "detail" })).toBeNull();
		await act(async () =>
			fireEvent.click(within(view.getByRole("dialog")).getByText("soon")),
		);
		const detail = view.getByRole("textbox", { name: "detail" });
		expect(document.activeElement).toBe(detail);
		await act(async () => fireEvent.change(detail, { target: { value: "" } }));
		// Once it is left, it reads again, and with nothing in it offers more.
		await act(async () => fireEvent.blur(detail));
		expect(view.getByRole("button", { name: "Add more detail" })).toBeTruthy();
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
			// Focus lights up its links, which is a render of its own.
			act(() => grip.focus());
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
				within(view.getByRole("list", { name: "Untriaged todos" }))
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
