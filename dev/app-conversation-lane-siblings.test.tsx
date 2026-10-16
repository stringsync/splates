import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	newestFirst,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's agents a lane's orchestrator started", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const orchestrator = conversation({
		id: "orch",
		name: "Stats lane",
		messages: [message("user", "[ARBOR LANE 1]")],
	});
	const agent = conversation({
		id: "agent",
		task: "alpha",
		lastTask: "alpha",
		status: "running",
		startedBy: "orch",
		lastCaller: "orch",
		messages: [{ ...message("user", "[ARBOR TASK alpha]"), told: "orch" }],
	});
	const landed = conversation({
		id: "landed",
		task: null,
		lastTask: "beta",
		status: "idle",
		startedBy: "orch",
		lastCaller: "orch",
		messages: [
			{ ...message("user", "[ARBOR TASK beta]"), told: "orch" },
			message("agent", "## ✅ Merged beta onto main\n\nThe totals lead."),
		],
	});
	const snapshot = {
		tasks: [details({ task: "alpha", caller: "orch", handedTo: "agent" })],
		lanes: [{ id: 1, name: "Stats" }],
		laneNames: [{ id: 1, name: "Stats" }],
		todos: [
			todo({
				id: 5,
				subject: "Break the totals down",
				lane: 1,
				position: 1,
				takenBy: "alpha",
			}),
			todo({
				id: 6,
				subject: "Export the breakdown",
				lane: 1,
				position: 2,
				blockedBy: [5],
			}),
		],
	};

	it("nests each under the orchestrator by its plain name, with how it stands", async () => {
		const view = await testing.openConversations(
			newestFirst([orchestrator, agent]),
			"orch",
			snapshot,
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		const more = await within(nav).findByRole("button", {
			name: "More for alpha",
		});

		const row = more.closest("li") as HTMLElement;
		expect(row.parentElement?.closest("li")).not.toBeNull();
		expect(within(row).getByText("alpha").className).not.toContain("italic");
		expect(within(row).getByRole("status", { name: "working" })).toBeTruthy();
	});

	it("gives it a composer of its own, and the lane it came from beside it", async () => {
		const view = await testing.openConversations(
			newestFirst([orchestrator, agent]),
			"agent",
			snapshot,
		);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "started by" }),
		);
		expect(view.queryByRole("note", { name: "handed out" })).toBeNull();
		expect(within(card).getByText("Stats")).toBeTruthy();
		expect(within(card).getByText("Break the totals down")).toBeTruthy();

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: /Started by/ })),
		);
		await waitFor(() =>
			expect(view.queryByRole("region", { name: "started by" })).toBeNull(),
		);
		expect(view.getByRole("region", { name: "Stats lane" })).toBeTruthy();
	});

	const reported = (...sentences: string[]) =>
		conversation({
			...orchestrator,
			messages: [
				message("user", "[ARBOR LANE 1]"),
				...sentences.map((sentence) =>
					message(
						"agent",
						`## ⏳ Working lanes Stats\n\n#### ${sentence}\n\n- Stats: #6 waits on #5.`,
					),
				),
			],
		});

	/** Opens the orchestrator among `conversations`, and its plan once drawn. */
	const openPlan = async (
		conversations: ReturnType<typeof conversation>[],
		board: typeof snapshot = snapshot,
	) => {
		const view = await testing.openConversations(
			newestFirst(conversations),
			"orch",
			board,
		);
		const plan = await waitFor(() =>
			view.getByRole("region", { name: "plan" }),
		);
		return { view, plan };
	};

	it("draws the plan in the latest Working card: Todo, Doing and Done", async () => {
		const { view, plan } = await openPlan([
			reported("alpha went out."),
			landed,
			agent,
		]);
		const column = (name: string) =>
			within(within(plan).getByRole("list", { name }))
				.getAllByRole("button")
				.map((each) => each.textContent);
		expect(column("Todo")).toEqual(["#6 Export the breakdownAfter #5"]);
		expect(column("Doing")).toEqual(["#5 Break the totals downalpha"]);
		expect(column("Done")).toEqual(["betaMerged"]);
		const doing = within(plan).getByRole("list", { name: "Doing" });
		expect(within(doing).getByRole("status", { name: "working" })).toBeTruthy();
		expect(within(plan).getByRole("img", { name: "merged" })).toBeTruthy();
		// One of three merged, while alpha's agent works.
		const progress = within(plan).getByRole("progressbar", { name: "merged" });
		expect(progress.getAttribute("aria-valuenow")).toBe("1");
		expect(progress.getAttribute("aria-valuemax")).toBe("3");
		expect(
			within(plan).getAllByRole("status", { name: "working" }),
		).toHaveLength(2);
		// Its lines on each lane give way to the plan.
		expect(view.queryByText("Stats: #6 waits on #5.")).toBeNull();
	});

	it("spins no longer once no agent of it works", async () => {
		const { plan } = await openPlan([
			reported("alpha went out."),
			landed,
			conversation({ ...agent, status: "idle" }),
		]);
		expect(within(plan).queryByRole("status", { name: "working" })).toBeNull();
	});

	it("folds the older Working cards to what changed", async () => {
		const { view } = await openPlan([
			reported("beta merged.", "alpha went out."),
			landed,
			agent,
		]);

		const cards = await waitFor(() => {
			const found = view.getAllByRole("region", { name: "working Stats" });
			expect(found).toHaveLength(2);
			return found;
		});
		const [older, latest] = cards as [HTMLElement, HTMLElement];
		expect(within(older).getByText("beta merged.")).toBeTruthy();
		expect(within(older).queryByRole("region", { name: "plan" })).toBeNull();
		expect(within(latest).getByRole("region", { name: "plan" })).toBeTruthy();
	});

	/** A lane longer than Todo and Done show at once. */
	const many = Array.from({ length: 5 }, (_, at) =>
		todo({
			id: 10 + at,
			subject: `Step ${at + 1}`,
			lane: 1,
			position: 3 + at,
		}),
	);
	const gone = Array.from({ length: 5 }, (_, at) =>
		conversation({
			...landed,
			id: `landed${at}`,
			lastTask: `done${at}`,
			messages: [
				{ ...message("user", `[ARBOR TASK done${at}]`), told: "orch" },
				message("agent", `## ✅ Merged done${at} onto main`),
			],
		}),
	);

	it("shows the first of a long Todo and the last of a long Done, the rest a click away", async () => {
		const { plan } = await openPlan(
			[reported("alpha went out."), ...gone, agent],
			{ ...snapshot, todos: [...snapshot.todos, ...many] },
		);
		const todos = within(plan).getByRole("list", { name: "Todo" });
		expect(
			within(todos)
				.getAllByRole("button")
				.map((each) => each.textContent),
		).toEqual([
			"#6 Export the breakdownAfter #5",
			"#10 Step 1Ready",
			"#11 Step 2Ready",
			"3 more",
		]);
		const done = within(plan).getByRole("list", { name: "Done" });
		expect(within(done).getAllByRole("button")[0]?.textContent).toBe(
			"2 earlier",
		);
		expect(within(done).getAllByRole("button")).toHaveLength(4);

		await act(async () =>
			fireEvent.click(within(todos).getByRole("button", { name: "3 more" })),
		);
		expect(within(todos).getAllByRole("button")).toHaveLength(6);
	});

	/** The board once lane 1's todos all landed: the lane is gone. */
	const emptied = { ...snapshot, tasks: [], lanes: [], todos: [] };

	it("turns the latest Working card's plan into how many landed once its lanes are done", async () => {
		const { plan } = await openPlan(
			[reported("alpha went out."), landed, ...gone.slice(0, 4)],
			emptied,
		);

		expect(within(plan).queryAllByRole("list")).toHaveLength(0);
		expect(plan.textContent).toContain("All 5 merged");
		expect(plan.textContent).toContain("arbor dev tells the orchestrator");
		expect(within(plan).queryByRole("status", { name: "working" })).toBeNull();

		await act(async () =>
			fireEvent.click(
				within(plan).getByRole("button", { name: "Nudge it now" }),
			),
		);

		expect(testing.posted("/api/conversations/orch/prompt")).toEqual([
			{ method: "POST", body: { text: "[ARBOR LANES DONE]" } },
		]);
		await waitFor(() => expect(plan.textContent).toContain("Nudged."));
	});

	it("says how many landed in the latest Finished card, under its lines", async () => {
		const { view, plan } = await openPlan(
			[
				conversation({
					...reported("alpha went out."),
					messages: [
						...reported("alpha went out.").messages,
						message(
							"agent",
							"## 🏁 Finished lanes Stats\n\nThe totals lead.\n\n- Stats: #5 and #6 merged.",
						),
					],
				}),
				conversation({
					...landed,
					messages: [
						landed.messages[0] as ReturnType<typeof message>,
						{
							...message("agent", "## ✅ Merged beta onto main"),
							until: new Date(Date.now() - 4 * 60_000).toISOString(),
						},
					],
				}),
			],
			emptied,
		);

		const finished = view.getByRole("region", { name: "finished Stats" });
		expect(within(finished).getByRole("region", { name: "plan" })).toBe(plan);
		expect(finished.textContent).toContain("#5 and #6 merged.");
		expect(plan.textContent).toContain("All 1 merged 4m ago");
		expect(plan.textContent).not.toContain("arbor dev tells");
		expect(
			within(plan).queryByRole("button", { name: "Nudge it now" }),
		).toBeNull();
		const working = view.getByRole("region", { name: "working Stats" });
		expect(within(working).queryByRole("region", { name: "plan" })).toBeNull();
	});
});
