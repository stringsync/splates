import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	snapshot,
	Testing,
	textIn,
	todo,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's composer references", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const board = {
		todos: [todo({ id: 12, subject: "Retry the upload on a 413", lane: 3 })],
		lanes: [{ id: 3, name: "Uploads" }],
	};

	/**
	 * The conversations page on `on`, its composer's box, a key pressed in
	 * it, the list `#` opens, and the row highlighted there.
	 */
	const opened = async (on = board) => {
		const view = await testing.openConversations([], null, on);
		const box = view.getByRole("textbox", { name: "Message input" });
		const list = () => view.getByRole("listbox", { name: "references" });
		return {
			view,
			box,
			key: (name: string) =>
				act(async () => fireEvent.keyDown(box, { key: name })),
			list,
			highlighted: () =>
				list().querySelector("[data-highlighted]")?.textContent,
		};
	};

	it("lists arbor's items by category for a #, and writes the one picked as a chip", async () => {
		const { view, box } = await opened();

		await typeIn(box, "#");
		const categories = await waitFor(() =>
			view.getByRole("listbox", { name: "references" }),
		);
		expect(
			within(categories)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Directives", "Todos", "Lanes", "Tasks"]);
		await act(async () =>
			fireEvent.click(
				within(categories).getByRole("option", { name: /Todos/ }),
			),
		);
		const todos = view.getByRole("listbox", { name: "references" });
		expect(
			within(todos)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Retry the upload on a 413#12"]);

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(within(box).getByTitle("[ARBOR TODO #12]")).toBeTruthy(),
		);
		expect(textIn(box)).toBe("[ARBOR TODO #12] ");
		expect(testing.posted("/api/conversations")).toEqual([]);
	});

	it("reaches Back with the arrow keys in a category, and goes back on Enter", async () => {
		const { view, box } = await opened();
		const key = (name: string) =>
			act(async () => fireEvent.keyDown(box, { key: name }));
		const highlighted = () =>
			view
				.getByRole("listbox", { name: "references" })
				.querySelector("[data-highlighted]")?.textContent;

		await typeIn(box, "#");
		await waitFor(() => view.getByRole("listbox", { name: "references" }));
		await key("ArrowDown");
		await key("Enter");
		expect(highlighted()).toBe("Retry the upload on a 413#12");

		await key("ArrowUp");
		expect(highlighted()).toBe("Back");
		await key("ArrowDown");
		expect(highlighted()).toBe("Retry the upload on a 413#12");
		await key("ArrowDown");
		expect(highlighted()).toBe("Back");

		await key("Enter");
		expect(
			within(view.getByRole("listbox", { name: "references" }))
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Directives", "Todos", "Lanes", "Tasks"]);
		expect(textIn(box)).toBe("#");
		expect(testing.posted("/api/conversations")).toEqual([]);
	});

	it("keeps the row the arrow keys are on while the pointer rests on the list", async () => {
		const { box, key, list, highlighted } = await opened({
			todos: [1, 2, 3].map((id) => todo({ id, subject: `Todo ${id}` })),
			lanes: [],
		});
		const point = (subject: string, left: number) =>
			act(async () =>
				fireEvent.mouseMove(
					within(list()).getByRole("option", {
						name: new RegExp(subject),
					}),
					{ clientX: left, clientY: 10 },
				),
			);

		await typeIn(box, "#");
		await waitFor(list);
		await key("ArrowDown");
		await key("Enter");
		expect(highlighted()).toBe("Todo 1#1");

		// Rows scrolling under a pointer that stays put, or only trembles.
		await point("Todo 3", 100);
		await point("Todo 3", 102);
		expect(highlighted()).toBe("Todo 1#1");
		await key("ArrowDown");
		await point("Todo 1", 101);
		expect(highlighted()).toBe("Todo 2#2");

		// A pointer that really moves takes the highlight.
		await point("Todo 3", 120);
		expect(highlighted()).toBe("Todo 3#3");
		await point("Todo 1", 121);
		expect(highlighted()).toBe("Todo 1#1");
	});

	it("keeps the row the arrow keys are on as the board changes", async () => {
		const todos = [1, 2, 3].map((id) => todo({ id, subject: `Todo ${id}` }));
		const { box, key, list, highlighted } = await opened({ todos, lanes: [] });

		await typeIn(box, "#");
		await waitFor(list);
		await key("ArrowDown");
		await key("Enter");
		await key("ArrowDown");
		expect(highlighted()).toBe("Todo 2#2");

		// A todo added above it, as another agent might while the list is open.
		testing.served = snapshot({
			todos: [todo({ id: 4, subject: "Todo 4" }), ...todos],
			lanes: [],
			tasks: [details({ task: "alpha" })],
		});
		await act(async () => testing.stream?.onmessage?.());
		await waitFor(() =>
			expect(
				within(list()).getByRole("option", { name: /Todo 4/ }),
			).toBeTruthy(),
		);
		expect(highlighted()).toBe("Todo 2#2");
		await key("ArrowDown");
		expect(highlighted()).toBe("Todo 3#3");

		// A search still starts on its first match.
		await typeIn(box, "#Todo");
		await waitFor(() => expect(highlighted()).toBe("Todo 4#4"));
	});

	it("searches every category for what follows the #", async () => {
		const { view, box } = await opened();

		await typeIn(box, "see #upl");
		const found = await waitFor(() =>
			view.getByRole("listbox", { name: "references" }),
		);
		expect(
			within(found)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Retry the upload on a 413#12", "Uploadslane 3"]);
		await act(async () => fireEvent.keyDown(box, { key: "ArrowDown" }));
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(within(box).getByTitle("[ARBOR LANE 3]")).toBeTruthy(),
		);
		expect(textIn(box)).toBe("see [ARBOR LANE 3] ");
	});

	it("writes a system picked after a #, by its name when an alias found it", async () => {
		testing.systems = [
			{ name: "playback", aliases: ["player"], globs: ["src/audio/**"] },
		];
		const { view, box } = await opened();

		await typeIn(box, "fix #playe");
		const found = await waitFor(() =>
			view.getByRole("listbox", { name: "references" }),
		);
		expect(
			within(found)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["playbackplayer"]);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() => expect(textIn(box)).toBe("fix #playback "));
		expect(within(box).getByRole("button", { name: "playback" })).toBeTruthy();
	});

	it("offers no system its name or alias calls without a #, and sends on Enter", async () => {
		testing.systems = [
			{ name: "playback", aliases: ["player"], globs: ["src/audio/**"] },
		];
		const { view, box } = await opened();

		await typeIn(box, "fix playback");
		expect(view.queryByRole("listbox", { name: "references" })).toBeNull();
		await typeIn(box, "the Player");
		expect(view.queryByRole("listbox", { name: "references" })).toBeNull();

		testing.reply = conversation({ id: "c9", status: "starting" });
		await typeIn(box, "fix player");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c9/prompt")).toEqual([
				{ method: "POST", body: { text: "fix player" } },
			]),
		);
	});

	it("offers the systems as a category of their own", async () => {
		testing.systems = [{ name: "mixer", globs: ["src/mixer/**"] }];
		const { view, box } = await opened();

		await typeIn(box, "#");
		const categories = await waitFor(() =>
			view.getByRole("listbox", { name: "references" }),
		);
		await act(async () =>
			fireEvent.click(
				within(categories).getByRole("option", { name: /Systems/ }),
			),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() => expect(textIn(box)).toBe("#mixer "));
	});

	it("writes a project picked after a #, and sends it as typed", async () => {
		testing.projects = [
			{
				slug: "shop",
				root: "/Users/me/shop",
				gone: false,
				focused: false,
				conversations: [],
				waiting: 0,
			},
		];
		const { view, box } = await opened();

		await typeIn(box, "match #shop");
		const found = await waitFor(() =>
			view.getByRole("listbox", { name: "references" }),
		);
		expect(
			within(found)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["shop/Users/me/shop"]);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() => expect(textIn(box)).toBe("match #shop "));
		expect(within(box).getByRole("button", { name: "shop" })).toBeTruthy();
		testing.reply = conversation({ id: "c9", status: "starting" });
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c9/prompt")).toEqual([
				{ method: "POST", body: { text: "match #shop" } },
			]),
		);
	});

	it("runs a conversation's action picked after a #, writing nothing", async () => {
		const view = await testing.openConversations([
			conversation({ title: "alpha" }),
		]);
		const box = view.getByRole("textbox", {
			name: "Message input",
		});

		await typeIn(box, "#archi");
		await waitFor(() => view.getByRole("listbox", { name: "references" }));
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
		// Archived, it goes on to a new conversation, leaving no draft behind.
		await waitFor(() => expect(location.hash).toBe("#conversations/new"));
		expect(localStorage.getItem("arbor.draft.c1") ?? "").toBe("");
	});
});
