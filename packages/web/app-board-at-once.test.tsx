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

describe("App's board writes at once", () => {
	let testing: Testing;
	let view: Awaited<ReturnType<Testing["open"]>>;

	beforeEach(async () => {
		testing = new Testing();
		view = await testing.open({
			todos: [
				todo({ id: 1, subject: "first", position: 1, lane: 1 }),
				todo({ id: 2, subject: "second", position: 2, lane: 2 }),
				todo({ id: 3, subject: "loose", position: 3 }),
			],
			lanes: [
				{ id: 1, name: "Licensing" },
				{ id: 2, name: "Docs" },
			],
		});
		// Each write waits for the test to answer it, as a slow server would.
		testing.holdWrites();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The subjects of a column's cards, top first. */
	const cards = (column: string) =>
		within(view.getByRole("list", { name: `${column} todos` }))
			.queryAllByRole("listitem")
			.map((card) => card.textContent ?? "");

	const columns = () =>
		view
			.getAllByRole("region")
			.map((region) => region.getAttribute("aria-label"));

	/** Answers the writes held, refused with `refusal` when given. */
	async function answer(refusal?: string): Promise<void> {
		if (refusal !== undefined) {
			testing.refuseWrites = { reason: "usage", message: refusal };
		}
		await act(async () => testing.release());
	}

	async function pick(lane: string, name: string): Promise<void> {
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: `${lane} actions` })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name })),
			),
		);
	}

	it("adds and renames a lane at the click, before the server answers", async () => {
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add another lane" })),
		);
		const name = view.getByRole("textbox", { name: "new lane name" });
		await act(async () =>
			fireEvent.change(name, { target: { value: "Score editor" } }),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add lane" })),
		);

		expect(columns()).toContain("Score editor");
		expect((name as HTMLInputElement).value).toBe("");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Licensing" })),
		);
		const rename = view.getByRole("textbox", { name: "lane name" });
		await act(async () =>
			fireEvent.change(rename, { target: { value: "Licenses" } }),
		);
		await act(async () => fireEvent.keyDown(rename, { key: "Enter" }));

		expect(columns()).toContain("Licenses");
		expect(columns()).not.toContain("Licensing");
	});

	it("removes a lane at once, and puts it back saying why when refused", async () => {
		await pick("Docs", "Remove lane, untriage its todos");

		expect(columns()).not.toContain("Docs");
		expect(cards("Untriaged").join()).toContain("second");

		await answer("in use");

		const docs = await waitFor(() =>
			view.getByRole("region", { name: "Docs" }),
		);
		expect(cards("Docs").join()).toContain("second");
		expect(within(docs).getByRole("alert").textContent).toBe(
			"Lane not removed: in use",
		);
	});

	it("moves a lane's todos into another at once", async () => {
		await pick("Docs", "Licensing");

		expect(columns()).not.toContain("Docs");
		expect(cards("Licensing")).toEqual([
			expect.stringContaining("first"),
			expect.stringContaining("second"),
		]);
	});

	it("shows a todo added at once, the box empty for the next", async () => {
		const docs = view.getByRole("region", { name: "Docs" });
		await act(async () =>
			fireEvent.click(within(docs).getByRole("button", { name: "Add a todo" })),
		);
		const box = view.getByRole("textbox", {
			name: "new todo",
		}) as HTMLTextAreaElement;
		await act(async () =>
			fireEvent.change(box, { target: { value: "write the docs" } }),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(cards("Docs").join()).toContain("write the docs");
		expect(box.value).toBe("");

		await answer("too long");

		await waitFor(() => expect(box.value).toBe("write the docs"));
		expect(cards("Docs").join()).not.toContain("write the docs");
		expect(within(docs).getByRole("alert").textContent).toBe(
			"Not added: too long",
		);
	});

	it("closes the dialog on Save and shows the edit at once, keeping it when refused", async () => {
		await act(async () => fireEvent.click(view.getByText("loose")));
		const subject = await waitFor(() =>
			view.getByRole("textbox", { name: "subject" }),
		);
		await act(async () =>
			fireEvent.change(subject, { target: { value: "loose ends" } }),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Save" })),
		);

		expect(view.queryByRole("dialog")).toBeNull();
		expect(cards("Untriaged").join()).toContain("loose ends");

		await answer("no");

		await waitFor(() =>
			expect(cards("Untriaged").join()).toContain("Not saved: no"),
		);
		expect(cards("Untriaged").join()).not.toContain("loose ends");
		// What was typed comes back when it opens again.
		await act(async () => fireEvent.click(view.getByText("loose")));
		const again = await waitFor(() =>
			view.getByRole("textbox", { name: "subject" }),
		);
		expect((again as HTMLInputElement).value).toBe("loose ends");
	});

	it("takes a todo removed from its dialog off the board at once", async () => {
		await act(async () => fireEvent.click(view.getByText("loose")));
		const remove = await waitFor(() =>
			view.getByRole("button", { name: "Remove" }),
		);
		await act(async () => fireEvent.click(remove));
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Remove for good" })),
		);

		expect(view.queryByRole("dialog")).toBeNull();
		expect(cards("Untriaged")).toEqual([]);
	});

	it("keeps an expected change over the refetch that began before its write landed", async () => {
		const arrive = testing.holdSnapshots();
		await pick("Docs", "Remove lane, untriage its todos");
		await act(async () => testing.stream?.onmessage?.());
		await answer();
		await act(async () => arrive());

		expect(columns()).not.toContain("Docs");
	});
});
