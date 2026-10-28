import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	clickShown,
	fireEvent,
	snapshot,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's board writes held pending", () => {
	let testing: Testing;
	let view: Awaited<ReturnType<Testing["open"]>>;

	const first = () => todo({ id: 1, subject: "first", position: 1, lane: 1 });
	const second = () => todo({ id: 2, subject: "second", position: 2, lane: 2 });
	const loose = () => todo({ id: 3, subject: "loose", position: 3 });
	const licensing = { id: 1, name: "Licensing" };
	const docsLane = { id: 2, name: "Docs" };

	beforeEach(async () => {
		testing = new Testing();
		view = await testing.open({
			todos: [first(), second(), loose()],
			lanes: [licensing, docsLane],
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
		within(view.getByRole("list", { name: `${column} tasks` }))
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

	/** The server lists `overrides` as the board, as it does once a write lands. */
	async function serve(
		overrides: Parameters<typeof snapshot>[0],
	): Promise<void> {
		testing.served = snapshot(overrides);
		await act(async () => testing.stream?.onmessage?.());
	}

	async function pick(lane: string, name: string): Promise<void> {
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: `${lane} actions` })),
		);
		await clickShown(() => view.getByRole("menuitem", { name }));
	}

	/** Removes a lane with tasks in it, past the dialog that asks first. */
	async function removeLane(lane: string): Promise<void> {
		await pick(lane, "Remove lane and its tasks");
		await clickShown(() =>
			view.getByRole("button", { name: "Remove lane and tasks" }),
		);
	}

	/** Whether a lane's wrapper says a write is pending on it. */
	const busy = (lane: string) =>
		view
			.getByRole("region", { name: lane })
			.closest("[aria-busy]")
			?.getAttribute("aria-busy") === "true";

	it("holds an added lane pending, the form as typed, until the server lists it, and renames likewise", async () => {
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

		expect(columns()).not.toContain("Score editor");
		expect((name as HTMLInputElement).value).toBe("Score editor");
		expect((name as HTMLInputElement).disabled).toBe(true);
		expect(
			view.getByRole("button", { name: "Add lane" }).getAttribute("aria-busy"),
		).toBe("true");

		await answer();
		await serve({
			todos: [first(), second(), loose()],
			lanes: [licensing, docsLane, { id: 3, name: "Score editor" }],
		});
		await waitFor(() => expect(columns()).toContain("Score editor"));

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Licensing" })),
		);
		const rename = view.getByRole("textbox", { name: "lane name" });
		await act(async () =>
			fireEvent.change(rename, { target: { value: "Licenses" } }),
		);
		await act(async () => fireEvent.keyDown(rename, { key: "Enter" }));

		expect(columns()).toContain("Licensing");
		expect(columns()).not.toContain("Licenses");
		expect(busy("Licensing")).toBe(true);

		await answer();
		await serve({
			todos: [first(), second(), loose()],
			lanes: [
				{ id: 1, name: "Licenses" },
				docsLane,
				{ id: 3, name: "Score editor" },
			],
		});
		await waitFor(() => expect(columns()).toContain("Licenses"));
		expect(columns()).not.toContain("Licensing");
	});

	it("asks before removing a lane with tasks, and keeps it on Cancel", async () => {
		await pick("Docs", "Remove lane and its tasks");
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(within(dialog).getByText("Remove Docs?")).toBeTruthy();
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(columns()).toContain("Docs");
		expect(cards("Docs").join()).toContain("second");
	});

	it("holds a lane removal pending with the lane in place, then drops it, or keeps it saying why when refused", async () => {
		await removeLane("Docs");

		expect(columns()).toContain("Docs");
		expect(busy("Docs")).toBe(true);
		expect(cards("Docs").join()).toContain("second");

		await answer("in use");

		const docs = await waitFor(() =>
			view.getByRole("region", { name: "Docs" }),
		);
		expect(busy("Docs")).toBe(false);
		expect(cards("Docs").join()).toContain("second");
		expect(within(docs).getByRole("alert").textContent).toBe(
			"Lane not removed: in use",
		);
	});

	it("removes a lane once the server drops it", async () => {
		await removeLane("Docs");
		expect(columns()).toContain("Docs");

		await answer();
		await serve({ todos: [first(), loose()], lanes: [licensing] });

		await waitFor(() => expect(columns()).not.toContain("Docs"));
	});

	it("holds a lane's todos in place while they move into another", async () => {
		await pick("Docs", "Licensing");

		expect(columns()).toContain("Docs");
		expect(cards("Licensing")).toEqual([expect.stringContaining("first")]);

		await answer();
		await serve({
			todos: [first(), todo({ ...second(), lane: 1 }), loose()],
			lanes: [licensing],
		});

		await waitFor(() => expect(columns()).not.toContain("Docs"));
		expect(cards("Licensing")).toEqual([
			expect.stringContaining("first"),
			expect.stringContaining("second"),
		]);
	});

	it("holds an added todo pending in the box until the server lists it, or keeps it saying why when refused", async () => {
		const docs = view.getByRole("region", { name: "Docs" });
		await act(async () =>
			fireEvent.click(within(docs).getByRole("button", { name: "Add a task" })),
		);
		const box = view.getByRole("textbox", {
			name: "new task",
		}) as HTMLTextAreaElement;
		await act(async () =>
			fireEvent.change(box, { target: { value: "write the docs" } }),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(cards("Docs").join()).not.toContain("write the docs");
		expect(box.value).toBe("write the docs");
		expect(box.disabled).toBe(true);
		expect(
			within(docs)
				.getByRole("button", { name: "Add task" })
				.getAttribute("aria-busy"),
		).toBe("true");

		await answer("too long");

		await waitFor(() => expect(box.disabled).toBe(false));
		expect(box.value).toBe("write the docs");
		expect(cards("Docs").join()).not.toContain("write the docs");
		expect(within(docs).getByRole("alert").textContent).toBe(
			"Not added: too long",
		);
	});

	it("lists an added todo once the server shows it, the box empty for the next", async () => {
		const docs = view.getByRole("region", { name: "Docs" });
		await act(async () =>
			fireEvent.click(within(docs).getByRole("button", { name: "Add a task" })),
		);
		const box = view.getByRole("textbox", {
			name: "new task",
		}) as HTMLTextAreaElement;
		await act(async () =>
			fireEvent.change(box, { target: { value: "write the docs" } }),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		await answer();
		await serve({
			todos: [
				first(),
				second(),
				loose(),
				todo({ id: 4, subject: "write the docs", position: 4, lane: 2 }),
			],
			lanes: [licensing, docsLane],
		});

		await waitFor(() =>
			expect(cards("Docs").join()).toContain("write the docs"),
		);
		await waitFor(() => expect(box.value).toBe(""));
	});

	it("closes the dialog on Save and keeps the card as it was, pending, until the server shows the edit, or says why when refused", async () => {
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
		expect(cards("Untriaged").join()).not.toContain("loose ends");

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

	it("shows an edit once the server lists it", async () => {
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
		await answer();
		await serve({
			todos: [first(), second(), todo({ ...loose(), subject: "loose ends" })],
			lanes: [licensing, docsLane],
		});

		await waitFor(() =>
			expect(cards("Untriaged").join()).toContain("loose ends"),
		);
	});

	it("keeps a todo removed from its dialog on the board, pending, until the server drops it", async () => {
		await act(async () => fireEvent.click(view.getByText("loose")));
		const remove = await waitFor(() =>
			view.getByRole("button", { name: "Remove" }),
		);
		await act(async () => fireEvent.click(remove));
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Remove for good" })),
		);

		expect(view.queryByRole("dialog")).toBeNull();
		expect(cards("Untriaged").join()).toContain("loose");

		await answer();
		await serve({ todos: [first(), second()], lanes: [licensing, docsLane] });

		await waitFor(() => expect(cards("Untriaged")).toEqual([]));
	});

	it("stays pending over the refetch that began before its write landed", async () => {
		const arrive = testing.holdSnapshots();
		await removeLane("Docs");
		await act(async () => testing.stream?.onmessage?.());
		await answer();
		await act(async () => arrive());

		expect(columns()).toContain("Docs");
		expect(busy("Docs")).toBe(true);
	});
});
