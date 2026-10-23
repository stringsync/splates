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
		fireEvent.click(view.getByRole("tab", { name: /Queue/ })),
	);
	await act(async () =>
		fireEvent.click(view.getByRole("tab", { name: /Board/ })),
	);
}

/** Opens todo `subject` to edit, and hands back its subject's box. */
async function edit(view: View, subject: string): Promise<HTMLElement> {
	await act(async () => fireEvent.click(view.getByText(subject)));
	return waitFor(() => view.getByRole("textbox", { name: "subject" }));
}

/** Writes `text` into `box`, as typing it would. */
async function change(box: HTMLElement, text: string): Promise<void> {
	await act(async () => fireEvent.change(box, { target: { value: text } }));
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

	/** Reloads the page, as `testing.open` takes `held`. */
	const reload = (held?: Parameters<Testing["open"]>[0]) => {
		cleanup();
		return testing.open(held);
	};

	it("keeps a todo being added per lane, across pages and a reload, until it is added", async () => {
		const lanes = [{ id: 4, name: "Docs" }];
		let view = await testing.open({ lanes });

		const docs = view.getByRole("region", { name: "Docs" });
		await act(async () =>
			fireEvent.click(within(docs).getByRole("button", { name: "Add a task" })),
		);
		await change(
			view.getByRole("textbox", { name: "new task" }),
			"write the docs",
		);
		await away(view);
		expect(value(view, "new task")).toBe("write the docs");

		view = await reload({ lanes });
		// Open on its own in its lane, and only there.
		expect(view.getAllByRole("textbox", { name: "new task" })).toHaveLength(1);
		const box = within(view.getByRole("region", { name: "Docs" })).getByRole(
			"textbox",
			{ name: "new task" },
		);
		expect((box as HTMLTextAreaElement).value).toBe("write the docs");

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		await waitFor(() => expect(testing.posts).toHaveLength(1));
		await waitFor(() => expect(value(view, "new task")).toBe(""));
		view = await reload({ lanes });
		expect(view.queryByRole("textbox", { name: "new task" })).toBeNull();
	});

	it("keeps a file attached across pages and a reload, and names it once a reload drops it", async () => {
		let view = await testing.open();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add a task" })),
		);
		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });
		await act(async () =>
			fireEvent.paste(view.getByRole("textbox", { name: "new task" }), {
				clipboardData: { files: [shot] },
			}),
		);
		await away(view);
		expect(view.getByRole("button", { name: "shot.png" })).toBeTruthy();
		expect(view.queryByText(/Lost on reload/)).toBeNull();

		testing.draftFiles.hold = true;
		view = await reload();
		await act(async () => testing.draftFiles.release());
		await waitFor(() =>
			expect(view.getByRole("button", { name: "shot.png" })).toBeTruthy(),
		);
		expect(view.queryByText(/Lost on reload/)).toBeNull();

		testing.draftFiles.kept.clear();
		view = await reload();
		expect(
			view.getByText("Lost on reload, attach again: shot.png"),
		).toBeTruthy();
	});

	it("offers an unsaved edit back when the todo is opened again", async () => {
		const todos = [todo({ id: 4, subject: "write docs", text: "soon" })];
		let view = await testing.open({ todos });

		const box = await edit(view, "write docs");
		expect(view.queryByText("Unsaved changes kept from before")).toBeNull();
		await change(box, "write the docs");
		await act(async () => fireEvent.keyDown(box, { key: "Escape" }));
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());

		view = await reload({ todos });
		await edit(view, "write docs");
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

		const box = await edit(view, "write docs");
		await change(box, "write the docs");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Save" })),
		);
		await waitFor(() => expect(testing.posts).toHaveLength(1));

		view = await reload({ todos });
		await edit(view, "write docs");
		await waitFor(() => expect(value(view, "subject")).toBe("write docs"));
		expect(view.queryByText("Unsaved changes kept from before")).toBeNull();
	});
});
