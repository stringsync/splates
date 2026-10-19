import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	agentList,
	type ConversationsView,
	cleanup,
	conversation,
	details,
	message,
	resize,
	Testing,
	within,
} from "./testing";

describe("A phone's inbox, nesting agents", () => {
	let testing: Testing;

	beforeEach(() => {
		// The inbox nests them, which only a phone has.
		resize(390, 844);
		testing = new Testing();
	});

	afterEach(() => {
		resize(1024, 768);
		cleanup();
		testing.dispose();
	});

	it("nests a part's conversations under the task it was handed out from, in a phone's inbox and the sidebar", async () => {
		const held = [
			conversation({
				id: "c1",
				task: "alpha",
				status: "running",
				createdAt: "2026-10-11T10:01:00.000Z",
			}),
			conversation({
				id: "c2",
				task: null,
				title: "Look around",
				createdAt: "2026-10-11T10:02:00.000Z",
			}),
			conversation({
				id: "c3",
				agent: "codex",
				task: "alpha-api",
				createdAt: "2026-10-11T10:03:00.000Z",
			}),
		];
		const tasks = {
			tasks: [
				details({ task: "alpha" }),
				details({ task: "alpha-api", base: "task/alpha" }),
			],
		};
		const view = await testing.openConversations(held, null, tasks);
		expect(inboxTrees(view)).toEqual([["alpha", "alpha-api"], ["Look around"]]);

		view.unmount();
		resize(1024, 768);
		const wide = await testing.openConversations(held, null, tasks);
		const nav = wide.getByRole("navigation", { name: "conversations" });
		expect(
			within(nav)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Look around", "alphaalpha-api", "alpha-api"]);
	});

	it("keeps a part's conversation under its caller's once both merged", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: null,
					lastTask: "alpha",
					lastBase: "main",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					agent: "codex",
					task: null,
					lastTask: "alpha-api",
					lastBase: "task/alpha",
					createdAt: "2026-10-11T10:03:00.000Z",
				}),
			],
			null,
			{ tasks: [] },
		);

		expect(inboxTrees(view)).toEqual([["alpha", "alpha-api"]]);
	});

	it("nests the tasks a conversation's agent added for its subagents under it, though they land on trunk", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "split-b",
					lastCaller: "c1",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					task: null,
					title: "Look around",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
			],
			null,
			{
				tasks: [
					details({ task: "split-a", caller: "c1" }),
					details({ task: "split-b", caller: "c1" }),
					details({ task: "split-c", caller: "c1" }),
					details({ task: "loose" }),
				],
			},
		);

		expect(inboxTrees(view)).toEqual([
			["split-b", "split-a", "split-c"],
			["loose"],
			["Look around"],
		]);
	});

	it("keeps a subagent's conversation under its caller's once its task merged", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: null,
					title: "Orchestrate",
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					agent: "codex",
					task: null,
					lastTask: "split-a",
					lastBase: "main",
					lastCaller: "c1",
					createdAt: "2026-10-11T10:03:00.000Z",
				}),
			],
			null,
			{ tasks: [] },
		);

		expect(inboxTrees(view)).toEqual([["Orchestrate", "split-a"]]);
	});

	// scry-ignore simple-test-setup: the unnamed conversations it lists are what it checks, and no other test opens with them
	it("stands in for a missing name, muted, with what the person first said, else Not started", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: null,
					messages: [
						message("user", "\n fix the login\nit loops"),
						message("agent", "On it"),
					],
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					task: null,
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({
					id: "c3",
					task: null,
					title: "Fix login",
					messages: [message("user", "fix the login")],
					createdAt: "2026-10-11T10:00:00.000Z",
				}),
			],
			null,
		);
		const names = within(view.getByRole("region", { name: "inbox" }))
			.getAllByRole("listitem")
			.map(nameIn);

		// The external agent at work leads the conversations at rest.
		expect(names.map((name) => name.textContent)).toEqual([
			"alpha",
			"Not started",
			"fix the login",
			"Fix login",
		]);
		expect(names.map((name) => name.classList.contains("italic"))).toEqual([
			false,
			true,
			true,
			false,
		]);
	});

	// scry-ignore simple-test-setup: the orchestrator and its lanes are what it checks, and no other test opens with them
	it("names a lane's orchestrator after its lanes, and the groomer so, marked as a lane, over a task it took and the agent's title", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: null,
					title: "Splates Lane 22",
					messages: [message("user", "[SPLATES LANE 22]")],
					createdAt: "2026-10-11T10:03:00.000Z",
				}),
				conversation({
					id: "c2",
					task: "add-line",
					lastTask: "add-line",
					messages: [message("user", "[SPLATES LANE 20]\n[SPLATES LANE 9]")],
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
				conversation({
					id: "c3",
					task: null,
					messages: [message("user", "[SPLATES LANE untriaged]")],
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c4",
					task: null,
					title: "Splates Groom 7",
					messages: [message("user", "[SPLATES GROOM #7]")],
					createdAt: "2026-10-11T10:00:30.000Z",
				}),
			],
			null,
			{
				laneNames: [
					{ id: 22, name: "Cloudflare Access" },
					{ id: 20, name: "Stats" },
				],
			},
		);
		const items = within(
			view.getByRole("region", { name: "inbox" }),
		).getAllByRole("listitem");
		const names = items.map(nameIn);

		expect(names.map((name) => name.textContent)).toEqual([
			"alpha",
			"Cloudflare Access",
			"Stats, Lane 9",
			"Untriaged",
			"Groomer",
		]);
		expect(
			items.map((item) => within(item).queryByLabelText("Lane") !== null),
		).toEqual([false, true, true, true, true]);
		expect(names.some((name) => name.classList.contains("italic"))).toBe(false);
	});
});

/** The inbox's agents, each with those it handed out after it, by name. */
function inboxTrees(view: ConversationsView): (string | null)[][] {
	return within(agentList(view))
		.getAllByRole("list")
		.map((list) =>
			within(list)
				.getAllByRole("listitem")
				.map((item) => nameIn(item).textContent),
		);
}

/** A row's name, first of what it truncates. */
function nameIn(item: HTMLElement): HTMLElement {
	return item.querySelector("span.truncate") as HTMLElement;
}
