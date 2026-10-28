import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	SOUND2SCORE_LANES,
	sound2score,
} from "@stringsync/splates-server/board/example";
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

describe("App's lanes", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** The server lists `overrides` as the board, as it does once a write lands. */
	async function serve(
		overrides: Parameters<typeof snapshot>[0],
	): Promise<void> {
		testing.served = snapshot(overrides);
		await act(async () => testing.stream?.onmessage?.());
	}

	/** The queued lanes of SOUND2SCORE_LANES, `queued` or not. */
	const lanesQueued = (queued: boolean) =>
		SOUND2SCORE_LANES.map((lane) =>
			lane.id === 1 && queued ? { ...lane, queued: true as const } : lane,
		);

	/** The subjects of a lane's cards, top first. */
	const steps = (view: Awaited<ReturnType<Testing["open"]>>, lane: string) =>
		within(view.getByRole("list", { name: `${lane} tasks` }))
			.getAllByRole("listitem")
			.map((card) => card.textContent ?? "");

	it("offers Groom on Untriaged and protects Backlog while allowing it to be queued", async () => {
		const view = await testing.open({
			todos: [todo({ id: 1, subject: "unplaced" })],
			lanes: [{ id: 0, name: "Backlog" }],
		});
		const untriaged = within(view.getByRole("region", { name: "Untriaged" }));
		expect(untriaged.getByRole("button", { name: "Groom" })).toBeTruthy();
		expect(
			untriaged.queryByRole("button", { name: "Queue Untriaged" }),
		).toBeNull();
		const backlog = within(view.getByRole("region", { name: "Backlog" }));
		expect(backlog.queryByTitle("Rename")).toBeNull();
		await clickShown(() =>
			backlog.getByRole("button", { name: "Backlog actions" }),
		);
		expect(view.queryByRole("menuitem", { name: "Rename" })).toBeNull();
		expect(view.queryByRole("menuitem", { name: /Remove lane/ })).toBeNull();
		expect(view.getByRole("menuitem", { name: "Queue lane" })).toBeTruthy();
	});

	it("shows a lane's tasks only the person queues under it, apart from its steps", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "first", lane: 1 }),
				todo({ id: 2, subject: "by hand", lane: 1, manual: true }),
				todo({ id: 3, subject: "taken", lane: 1, manual: true, takenBy: "t" }),
			],
			lanes: [{ id: 1, name: "Docs" }],
		});
		expect(steps(view, "Docs").map((card) => card.includes("by hand"))).toEqual(
			[false, false],
		);
		const hand = within(view.getByRole("region", { name: "Docs by hand" }));
		expect(
			within(hand.getByRole("list", { name: "Docs tasks by hand" }))
				.getAllByRole("listitem")
				.map((card) => card.textContent?.includes("by hand")),
		).toEqual([true]);
	});

	it("draws each lane as a named column, saying whether it is running and what blocks it", async () => {
		const todos = sound2score().map((each) =>
			[200, 209].includes(each.id)
				? { ...each, takenBy: "decoder" }
				: each.id === 177
					? { ...each, takenBy: "store" }
					: each,
		);
		const view = await testing.open({
			todos,
			lanes: SOUND2SCORE_LANES.map((record) =>
				record.name === "Audio, uploads and pricing"
					? { ...record, queued: true as const }
					: record,
			),
		});

		expect(steps(view, "Licensing")).toHaveLength(6);
		expect(steps(view, "Licensing")[0]).toContain(
			"Store a license per account",
		);
		const two = view.getByRole("region", {
			name: "Audio, uploads and pricing",
		});
		// Running, without naming who is on which task: the cards say that.
		// Only a queued lane shows it: one paused shows none.
		expect(
			within(two).getByTitle("An agent is at work on one of its tasks"),
		).toBeTruthy();
		expect(two.textContent).not.toContain("decoder on");
		expect(
			within(view.getByRole("region", { name: "Score editor" })).queryByTitle(
				"An agent is at work on one of its tasks",
			),
		).toBeNull();
		expect(
			within(view.getByRole("region", { name: "Licensing" })).queryByTitle(
				"An agent is at work on one of its tasks",
			),
		).toBeNull();
		// A lone hourglass, naming what blocks it only in its label and tooltip.
		const third = within(
			view.getByRole("list", { name: "Audio, uploads and pricing tasks" }),
		).getAllByRole("listitem")[2] as HTMLElement;
		expect(
			within(third).getByLabelText("Blocked by #177 in Licensing"),
		).toBeTruthy();
		// Every todo is in a lane: the untriaged column is empty.
		expect(
			within(
				view.getByRole("list", { name: "Untriaged tasks" }),
			).queryAllByRole("listitem"),
		).toHaveLength(0);
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
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("tab", { name: "Details" })),
		);
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

	it("says under a lane's header that its rename was refused", async () => {
		const view = await testing.open({
			todos: sound2score(),
			lanes: SOUND2SCORE_LANES,
		});
		const lane = view.getByRole("region", { name: "Licensing" });
		testing.refuseWrites = { reason: "usage", message: "taken" };

		await act(async () =>
			fireEvent.click(within(lane).getByRole("button", { name: "Licensing" })),
		);
		const name = view.getByRole("textbox", { name: "lane name" });
		await act(async () =>
			fireEvent.change(name, { target: { value: "Score editor" } }),
		);
		await act(async () => fireEvent.keyDown(name, { key: "Enter" }));

		await waitFor(() =>
			expect(within(lane).getByRole("alert").textContent).toBe(
				"Not renamed: taken",
			),
		);
	});

	it("moves a lane left or right from its menu, showing it there at once", async () => {
		const view = await testing.open({
			todos: sound2score(),
			lanes: SOUND2SCORE_LANES,
		});
		const columns = () =>
			view
				.getAllByRole("region")
				.map((region) => region.getAttribute("aria-label"));
		const pick = async (lane: string, name: string) => {
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: `${lane} actions` })),
			);
			await clickShown(() => view.getByRole("menuitem", { name }));
		};

		await pick("Score editor", "Move left");

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/lanes/3",
			method: "PUT",
			body: JSON.stringify({ position: 2 }),
		});
		expect(columns()).toEqual([
			"Untriaged",
			"Licensing",
			"Score editor",
			"Audio, uploads and pricing",
			"new lane",
		]);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Licensing actions" })),
		);
		const left = await waitFor(() =>
			view.getByRole("menuitem", { name: "Move left" }),
		);
		expect(left.getAttribute("aria-disabled")).toBe("true");
	});

	it("marks a lane blocked when its next task waits on one in another lane", async () => {
		const view = await testing.open({
			todos: sound2score().map((todo) =>
				todo.id === 200 ? { ...todo, blockedBy: [177] } : todo,
			),
			lanes: SOUND2SCORE_LANES,
		});
		expect(view.getByText("Blocked by #177")).toBeTruthy();
	});

	it("queues a lane whole from its menu, holding it pending until the server lists it queued", async () => {
		const view = await testing.open({
			todos: sound2score(),
			lanes: SOUND2SCORE_LANES,
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Licensing actions" })),
		);
		await clickShown(() => view.getByRole("menuitem", { name: "Queue lane" }));

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/lanes/1",
			method: "PUT",
			body: JSON.stringify({ queued: true }),
		});
		expect(view.queryByText("Queued lane")).toBeNull();
		expect(
			view
				.getByRole("region", { name: "Licensing" })
				.closest("[aria-busy]")
				?.getAttribute("aria-busy"),
		).toBe("true");

		await serve({ todos: sound2score(), lanes: lanesQueued(true) });

		await waitFor(() => expect(view.getByText("Queued lane")).toBeTruthy());
	});

	it("stops queueing a lane whole from its menu, holding the mark pending until the server drops it", async () => {
		const view = await testing.open({
			todos: sound2score(),
			lanes: SOUND2SCORE_LANES.map((lane) =>
				lane.id === 1 ? { ...lane, queued: true as const } : lane,
			),
		});
		expect(view.getByText("Queued lane")).toBeTruthy();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Licensing actions" })),
		);
		await clickShown(() =>
			view.getByRole("menuitem", { name: "Stop queueing lane" }),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/lanes/1",
			body: JSON.stringify({ queued: false }),
		});
		expect(view.getByText("Queued lane")).toBeTruthy();
		expect(
			view
				.getByRole("region", { name: "Licensing" })
				.closest("[aria-busy]")
				?.getAttribute("aria-busy"),
		).toBe("true");

		await serve({ todos: sound2score(), lanes: lanesQueued(false) });

		await waitFor(() => expect(view.queryByText("Queued lane")).toBeNull());
	});

	it("says a queued lane is stalled on a task taken out of the queue, and queues it from there", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "first", lane: 1, stage: "ready" }),
				todo({ id: 2, subject: "second", lane: 1, blockedBy: [1] }),
			],
			lanes: [{ id: 1, name: "Licensing", queued: true, skip: [1] }],
		});
		const stalled = view.getByRole("region", { name: "Licensing stalled" });
		expect(
			within(stalled).getByText("#1 was taken out of the queue"),
		).toBeTruthy();

		await act(async () =>
			fireEvent.click(
				within(stalled).getByRole("button", { name: "Queue #1" }),
			),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/todos/1/queued",
			method: "PUT",
			body: JSON.stringify({ queued: true }),
		});
		expect(
			view.getByRole("region", { name: "Licensing stalled" }),
		).toBeTruthy();

		await serve({
			todos: [
				todo({ id: 1, subject: "first", lane: 1, stage: "ready" }),
				todo({ id: 2, subject: "second", lane: 1, blockedBy: [1] }),
			],
			lanes: [{ id: 1, name: "Licensing", queued: true }],
		});

		await waitFor(() =>
			expect(
				view.queryByRole("region", { name: "Licensing stalled" }),
			).toBeNull(),
		);
	});

	it("shows stalled instead of running until its holdup clears", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "under way", lane: 1, takenBy: "agent" }),
				todo({ id: 2, subject: "skipped", lane: 1, stage: "ready" }),
				todo({ id: 3, subject: "waiting", lane: 1, blockedBy: [2] }),
			],
			lanes: [{ id: 1, name: "Licensing", queued: true, skip: [2] }],
		});
		const lane = within(view.getByRole("region", { name: "Licensing" }));

		const stalled = lane.getByRole("region", { name: "Licensing stalled" });
		expect(
			lane.queryByTitle("An agent is at work on one of its tasks"),
		).toBeNull();

		await act(async () =>
			fireEvent.click(
				within(stalled).getByRole("button", { name: "Queue #2" }),
			),
		);

		expect(
			lane.getByRole("region", { name: "Licensing stalled" }),
		).toBeTruthy();

		await serve({
			todos: [
				todo({ id: 1, subject: "under way", lane: 1, takenBy: "agent" }),
				todo({ id: 2, subject: "skipped", lane: 1, stage: "ready" }),
				todo({ id: 3, subject: "waiting", lane: 1, blockedBy: [2] }),
			],
			lanes: [{ id: 1, name: "Licensing", queued: true }],
		});

		await waitFor(() =>
			expect(
				lane.queryByRole("region", { name: "Licensing stalled" }),
			).toBeNull(),
		);
		expect(
			lane.getByTitle("An agent is at work on one of its tasks"),
		).toBeTruthy();
	});

	it("names a blocker in another project on a queued lane", async () => {
		const blocker = {
			project: "/repos/webappwiz",
			id: 20,
			subject: "Declare release events",
		};
		const view = await testing.open({
			todos: [
				todo({
					id: 1,
					subject: "Read release events",
					lane: 1,
					stage: "ready",
					blockedElsewhere: [blocker],
				}),
			],
			lanes: [{ id: 1, name: "Ships", queued: true }],
			elsewhere: {
				blockers: {
					1: [{ ...blocker, slug: "webappwiz", status: "ready" }],
				},
				following: {},
			},
		});
		const lane = within(view.getByRole("region", { name: "Ships" }));

		expect(lane.getByText("Blocked by webappwiz #20")).toBeTruthy();
		expect(
			lane.getByTitle(
				"Read release events waits on webappwiz #20 Declare release events, so the lane will not run until it lands",
			),
		).toBeTruthy();
	});

	it("queues a lane whole with one tap on its header", async () => {
		const view = await testing.open({
			todos: sound2score(),
			lanes: SOUND2SCORE_LANES,
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Queue Licensing" })),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/lanes/1",
			method: "PUT",
			body: JSON.stringify({ queued: true }),
		});
		expect(view.queryByText("Queued lane")).toBeNull();
		expect(
			view.queryByRole("button", { name: "Stop queueing Licensing" }),
		).toBeNull();

		await serve({ todos: sound2score(), lanes: lanesQueued(true) });

		await waitFor(() => expect(view.getByText("Queued lane")).toBeTruthy());
		expect(
			view.getByRole("button", { name: "Stop queueing Licensing" }),
		).toBeTruthy();
	});

	it("stops queueing a lane with one tap on its header", async () => {
		const view = await testing.open({
			todos: sound2score(),
			lanes: SOUND2SCORE_LANES.map((lane) =>
				lane.id === 1 ? { ...lane, queued: true as const } : lane,
			),
		});
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Stop queueing Licensing" }),
			),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/lanes/1",
			body: JSON.stringify({ queued: false }),
		});
		expect(view.getByText("Queued lane")).toBeTruthy();

		await serve({ todos: sound2score(), lanes: lanesQueued(false) });

		await waitFor(() => expect(view.queryByText("Queued lane")).toBeNull());
		expect(view.getByRole("button", { name: "Queue Licensing" })).toBeTruthy();
	});

	// scry-ignore simple-test-setup: each test here opens its own board; this one only lost a neighbour.
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
			fireEvent.click(within(dialog).getByRole("tab", { name: "Details" })),
		);
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
		await clickShown(() =>
			view.getByRole("menuitemcheckbox", { name: /^Licensing/ }),
		);

		expect(view.queryByRole("region", { name: "Licensing" })).toBeNull();
		expect(view.getByRole("button", { name: /1 hidden/ })).toBeTruthy();
		expect(
			JSON.parse(localStorage.getItem("splates.hiddenLanes") ?? ""),
		).toEqual([1]);
		cleanup();
		const again = await testing.open({
			todos: sound2score(),
			lanes: SOUND2SCORE_LANES,
		});
		expect(again.queryByRole("region", { name: "Licensing" })).toBeNull();

		// All at once: shown, then hidden, the menu staying open between.
		const all = (name: string) =>
			clickShown(() => again.getByRole("menuitem", { name }));
		await act(async () =>
			fireEvent.click(again.getByRole("button", { name: /^Lanes/ })),
		);
		await all("Show all");
		expect(again.getByRole("region", { name: "Licensing" })).toBeTruthy();
		await all("Hide all");
		expect(again.queryByRole("region", { name: "Licensing" })).toBeNull();
		expect(again.queryByRole("list", { name: "Untriaged tasks" })).toBeNull();
	});

	it("links a mention to its todo, and shows one that is gone as archived", async () => {
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
		expect(view.getByTitle(/#9 is archived/).innerHTML).toContain(
			"line-through",
		);
		expect(view.getByText("#3")).toBeTruthy();
		await act(async () => fireEvent.click(mention));
		await waitFor(() =>
			expect(view.getByRole("dialog", { name: /Task 1/ })).toBeTruthy(),
		);
	});
});
