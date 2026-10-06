import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SOUND2SCORE_LANES, sound2score } from "../example";
import {
	act,
	cleanup,
	fireEvent,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's lanes", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The subjects of a lane's cards, top first. */
	const steps = (view: Awaited<ReturnType<Testing["open"]>>, lane: string) =>
		within(view.getByRole("list", { name: `${lane} todos` }))
			.getAllByRole("listitem")
			.map((card) => card.textContent ?? "");

	it("draws each lane as a named column, saying who is on it and what blocks it", async () => {
		const todos = sound2score().map((each) =>
			[200, 209].includes(each.id)
				? { ...each, takenBy: "decoder" }
				: each.id === 187
					? { ...each, takenBy: "store" }
					: each,
		);
		const view = await testing.open({ todos, lanes: SOUND2SCORE_LANES });

		expect(steps(view, "Licensing")).toHaveLength(6);
		expect(steps(view, "Licensing")[0]).toContain(
			"Store a license per account",
		);
		const two = view.getByRole("region", {
			name: "Audio, uploads and pricing",
		});
		expect(two.textContent).toContain("decoder on #200, #209");
		// A lone hourglass, naming what blocks it only in its label and tooltip.
		const third = within(
			view.getByRole("list", { name: "Audio, uploads and pricing todos" }),
		).getAllByRole("listitem")[2] as HTMLElement;
		expect(
			within(third).getByLabelText("Blocked by #177 in Licensing"),
		).toBeTruthy();
		// Every todo is in a lane: the untriaged column is empty.
		expect(
			within(
				view.getByRole("list", { name: "Untriaged todos" }),
			).queryAllByRole("listitem"),
		).toHaveLength(0);
	});

	it("offers the lane's prompt above its first todo while no agent is on it", async () => {
		const copied: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void copied.push(text) },
		});
		const view = await testing.open({
			todos: sound2score().map((each) =>
				each.id === 207 ? { ...each, takenBy: "panes" } : each,
			),
			lanes: SOUND2SCORE_LANES,
		});

		// Licensing and the second lane have nobody; the editor has an agent.
		expect(view.getAllByRole("button", { name: "Start lane" })).toHaveLength(2);
		await act(async () =>
			fireEvent.click(
				within(
					view.getByRole("region", { name: "Audio, uploads and pricing" }),
				).getByRole("button", { name: "Start lane" }),
			),
		);

		expect(copied).toEqual(["[ARBOR LANE 2]"]);
	});

	it("unblocks with one tap in the dialog, sending what is left", async () => {
		const view = await testing.open({
			todos: sound2score(),
			lanes: SOUND2SCORE_LANES,
		});

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: /^Activate a license/ }),
			),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(within(dialog).getByText("Step 4 of 6 in Licensing")).toBeTruthy();
		expect(within(dialog).getByText("Blocked by")).toBeTruthy();
		expect(within(dialog).getByText("Blocking")).toBeTruthy();
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "unlink #177" }),
			),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/todos/196/blocked-by",
			method: "PUT",
			body: JSON.stringify({ blockedBy: [] }),
		});
	});

	it("adds a lane by name, keeps an empty one, and renames one in place", async () => {
		const view = await testing.open({
			todos: [todo({ id: 1, subject: "first", lane: 1 })],
			lanes: [
				{ id: 1, name: "Licensing" },
				{ id: 2, name: "Docs" },
			],
		});

		expect(view.getByRole("region", { name: "Docs" })).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add another lane" })),
		);
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "new lane name" }), {
				target: { value: "Score editor" },
			}),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add lane" })),
		);
		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/lanes",
			method: "POST",
			body: JSON.stringify({ name: "Score editor" }),
		});

		await act(async () =>
			fireEvent.click(
				within(view.getByRole("region", { name: "Licensing" })).getByRole(
					"button",
					{ name: "Licensing" },
				),
			),
		);
		const name = view.getByRole("textbox", { name: "lane name" });
		await act(async () =>
			fireEvent.change(name, { target: { value: "Licenses" } }),
		);
		await act(async () => fireEvent.keyDown(name, { key: "Enter" }));
		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/lanes/1",
			method: "PUT",
			body: JSON.stringify({ name: "Licenses" }),
		});
	});

	it("asks for a new lane's name in place when one is picked in the dialog", async () => {
		const view = await testing.open({
			todos: sound2score(),
			lanes: SOUND2SCORE_LANES,
		});

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: /^Activate a license/ }),
			),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("combobox", { name: "lane" })),
		);
		const option = await waitFor(() =>
			view.getByRole("option", { name: "A new lane…" }),
		);
		// Base UI picks on the pointer let go, not on a click alone.
		await act(async () => {
			fireEvent.pointerDown(option, { pointerType: "mouse" });
			fireEvent.mouseDown(option);
			fireEvent.pointerUp(option, { pointerType: "mouse" });
			fireEvent.mouseUp(option);
			fireEvent.click(option);
		});
		const name = await waitFor(() =>
			within(dialog).getByRole("textbox", { name: "new lane name" }),
		);
		expect(testing.posts).toHaveLength(0);
		await act(async () =>
			fireEvent.change(name, { target: { value: "Offline" } }),
		);
		await act(async () => fireEvent.submit(name));

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/todos/196/lane",
			method: "PUT",
			body: JSON.stringify({ lane: "new", name: "Offline" }),
		});
	});

	it("hides a lane from the board, and keeps it hidden for the next visit", async () => {
		const view = await testing.open({
			todos: sound2score(),
			lanes: SOUND2SCORE_LANES,
		});

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Lanes/ })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("menuitemcheckbox", { name: /^Licensing/ }),
				),
			),
		);

		expect(view.queryByRole("region", { name: "Licensing" })).toBeNull();
		expect(view.getByRole("button", { name: /1 hidden/ })).toBeTruthy();
		expect(JSON.parse(localStorage.getItem("arbor.hiddenLanes") ?? "")).toEqual(
			[1],
		);
		cleanup();
		const again = await testing.open({
			todos: sound2score(),
			lanes: SOUND2SCORE_LANES,
		});
		expect(again.queryByRole("region", { name: "Licensing" })).toBeNull();

		// All at once: shown, then hidden, the menu staying open between.
		const all = async (name: string) =>
			act(async () =>
				fireEvent.click(
					await waitFor(() => again.getByRole("menuitem", { name })),
				),
			);
		await act(async () =>
			fireEvent.click(again.getByRole("button", { name: /^Lanes/ })),
		);
		await all("Show all");
		expect(again.getByRole("region", { name: "Licensing" })).toBeTruthy();
		await all("Hide all");
		expect(again.queryByRole("region", { name: "Licensing" })).toBeNull();
		expect(again.queryByRole("list", { name: "Untriaged todos" })).toBeNull();
	});

	it("links a mention to its todo, and strikes one that is gone", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "first" }),
				todo({
					id: 2,
					subject: "second",
					position: 2,
					text: "Needs #1 and #9, but not `#3`.",
				}),
			],
		});

		const mention = view.getByRole("button", { name: "#1" });
		expect(mention.title).toBe("first");
		expect(view.getByTitle(/#9 is no longer on the list/).className).toContain(
			"line-through",
		);
		expect(view.getByText("#3")).toBeTruthy();
		await act(async () => fireEvent.click(mention));
		await waitFor(() =>
			expect(view.getByRole("dialog", { name: /Todo 1/ })).toBeTruthy(),
		);
	});
});
