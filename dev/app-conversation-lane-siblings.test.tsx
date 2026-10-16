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
		expect(view.getByRole("region", { name: "plan" })).toBeTruthy();
	});

	it("shows the orchestrator's plan: each todo with the agent on it, what waits, and what landed", async () => {
		const view = await testing.openConversations(
			newestFirst([orchestrator, landed, agent]),
			"orch",
			snapshot,
		);

		const plan = await waitFor(() =>
			view.getByRole("region", { name: "plan" }),
		);
		const rows = within(plan)
			.getAllByRole("button")
			.map((each) => each.textContent);
		expect(rows).toEqual([
			"#5 Break the totals downalpha",
			"#6 Export the breakdownWaits on #5",
			"beta",
		]);
		expect(within(plan).getByRole("status", { name: "working" })).toBeTruthy();
		expect(within(plan).getByRole("img", { name: "merged" })).toBeTruthy();
	});
});
