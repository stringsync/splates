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

type View = Awaited<ReturnType<Testing["open"]>>;

/** What the box under `name` holds. */
function value(view: View, name: string): string {
	return (view.getByRole("textbox", { name }) as HTMLInputElement).value;
}

/** Goes to the tasks and back to the todos. */
async function away(view: View): Promise<void> {
	await act(async () =>
		fireEvent.click(view.getByRole("tab", { name: /Tasks/ })),
	);
	await act(async () =>
		fireEvent.click(view.getByRole("tab", { name: /Todos/ })),
	);
}

describe("App's todo drafts", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("keeps a todo being added per lane, across pages and a reload, until it is added", async () => {
		const lanes = [{ id: 4, name: "Docs" }];
		let view = await testing.open({ lanes });

		const docs = view.getByRole("region", { name: "Docs" });
		await act(async () =>
			fireEvent.click(within(docs).getByRole("button", { name: "Add a todo" })),
		);
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "new todo" }), {
				target: { value: "write the docs" },
			}),
		);
		await away(view);
		expect(value(view, "new todo")).toBe("write the docs");

		cleanup();
		view = await testing.open({ lanes });
		// Open on its own in its lane, and only there.
		expect(view.getAllByRole("textbox", { name: "new todo" })).toHaveLength(1);
		const box = within(view.getByRole("region", { name: "Docs" })).getByRole(
			"textbox",
			{ name: "new todo" },
		);
		expect((box as HTMLTextAreaElement).value).toBe("write the docs");

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		await waitFor(() => expect(testing.posts).toHaveLength(1));
		await waitFor(() => expect(value(view, "new todo")).toBe(""));
		cleanup();
		view = await testing.open({ lanes });
		expect(view.queryByRole("textbox", { name: "new todo" })).toBeNull();
	});

	it("keeps a file attached across pages, and names it once a reload drops it", async () => {
		let view = await testing.open();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add a todo" })),
		);
		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });
		await act(async () =>
			fireEvent.paste(view.getByRole("textbox", { name: "new todo" }), {
				clipboardData: { files: [shot] },
			}),
		);
		await away(view);
		expect(view.getByRole("button", { name: "shot.png" })).toBeTruthy();
		expect(view.queryByText(/Lost on reload/)).toBeNull();

		cleanup();
		view = await testing.open();
		expect(
			view.getByText("Lost on reload, attach again: shot.png"),
		).toBeTruthy();
	});

	it("offers an unsaved edit back when the todo is opened again", async () => {
		const todos = [todo({ id: 4, subject: "write docs", text: "soon" })];
		let view = await testing.open({ todos });

		await act(async () => fireEvent.click(view.getByText("write docs")));
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "subject" }),
		);
		expect(view.queryByText("Unsaved changes kept from before")).toBeNull();
		await act(async () =>
			fireEvent.change(box, { target: { value: "write the docs" } }),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Escape" }));
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());

		cleanup();
		view = await testing.open({ todos });
		await act(async () => fireEvent.click(view.getByText("write docs")));
		await waitFor(() => expect(value(view, "subject")).toBe("write the docs"));
		const dialog = view.getByRole("dialog");
		expect(
			within(dialog).getByText("Unsaved changes kept from before"),
		).toBeTruthy();

		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Discard" })),
		);
		expect(value(view, "subject")).toBe("write docs");
		expect(view.queryByText("Unsaved changes kept from before")).toBeNull();
		expect(
			(
				within(dialog).getByRole("button", {
					name: "Save",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("drops an edit once it is saved", async () => {
		const todos = [todo({ id: 4, subject: "write docs" })];
		let view = await testing.open({ todos });

		await act(async () => fireEvent.click(view.getByText("write docs")));
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "subject" }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "write the docs" } }),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Save" })),
		);
		await waitFor(() => expect(testing.posts).toHaveLength(1));

		cleanup();
		view = await testing.open({ todos });
		await act(async () => fireEvent.click(view.getByText("write docs")));
		await waitFor(() => expect(value(view, "subject")).toBe("write docs"));
		expect(view.queryByText("Unsaved changes kept from before")).toBeNull();
	});
});
