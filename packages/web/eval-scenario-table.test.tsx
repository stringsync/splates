import "./testing-dom";
import { afterEach, expect, it } from "bun:test";
import type { ConversationState } from "@splates/server/conversations";
import type { ConversationFeed } from "./conversation-feed";
import { EvalAgentsEditor } from "./eval-agents";
import { loopTarget } from "./eval-loops";
import { EvalScenarioTable } from "./eval-scenario-table";
import { act, cleanup, fireEvent, render, waitFor } from "./testing";

const realFetch = globalThis.fetch;
afterEach(() => {
	cleanup();
	globalThis.fetch = realFetch;
});

it("lists scenarios worst first with what each tests, a summary and the next up", async () => {
	serve([]);
	const view = render(
		<EvalScenarioTable agents={agents()} onOpenBatch={() => {}} feed={feed} />,
	);
	await waitFor(() =>
		expect(view.getByText("0 of 2 scenarios passing")).toBeTruthy(),
	);
	expect(view.getByText("About one")).toBeTruthy();
	expect(view.queryByRole("columnheader", { name: /claude/ })).toBeNull();
	await waitFor(() => expect(view.getByText("skipped merge")).toBeTruthy());
	const rows = view.getAllByRole("row").map((row) => row.textContent ?? "");
	expect(rows[1]).toContain("a/one");
	expect(rows[2]).toContain("a/two");
	fireEvent.click(view.getByRole("button", { name: /Passing/ }));
	expect(view.getByText("No scenario matches this filter.")).toBeTruthy();
});

it("reviews the selected scenarios before starting, preserves choices on Back, and opens activity", async () => {
	const posts: string[] = [];
	serve(posts);
	let started = 0;
	const view = render(
		<EvalScenarioTable
			agents={agents()}
			onOpenBatch={() => {}}
			feed={feed}
			onStarted={() => {
				started += 1;
			}}
		/>,
	);
	fireEvent.click(
		await waitFor(() =>
			view.getByRole("checkbox", { name: "Select all scenarios" }),
		),
	);
	fireEvent.change(view.getByLabelText("Budget in dollars"), {
		target: { value: "7" },
	});
	fireEvent.change(view.getByLabelText("Run repetitions"), {
		target: { value: "2" },
	});
	fireEvent.click(view.getByRole("button", { name: "Review 2 scenarios" }));
	expect(view.getByText(/Total authorized eval budget/).textContent).toContain(
		"14.00",
	);
	expect(posts).toEqual([]);
	fireEvent.click(view.getByRole("button", { name: "Back" }));
	expect(view.getByLabelText("Budget in dollars").getAttribute("value")).toBe(
		"7",
	);
	fireEvent.click(view.getByRole("button", { name: "Review 2 scenarios" }));
	fireEvent.click(view.getByRole("button", { name: "Accept and start evals" }));
	await waitFor(() => expect(started).toBe(1));
	const plans = posts
		.filter((post) => post.includes('"words"'))
		.map((post) => JSON.parse(post).words);
	expect(plans).toHaveLength(2);
	expect(plans[0]).toContain("[SPLATES EVAL LOOP scenario a/one]");
	expect(plans[1]).toContain("[SPLATES EVAL LOOP scenario a/two]");
	expect(plans[0]).toContain("Budget: $7");
	expect(plans[0]).toContain("Repetitions: 2");
	expect(plans[0]).toContain("Agents: `claude:opus@high`");
});

it("opens a row to its prompt, how it is judged and its last run, with history folded", async () => {
	serve([]);
	const read = globalThis.fetch;
	globalThis.fetch = (async (input, init) =>
		String(input).includes("/api/evals/run")
			? Response.json({
					id: "batch-1#r1",
					status: "fail",
					target: {
						agent: "claude",
						model: "opus",
						effort: "high",
						skill: null,
					},
					input: "Merge this for me",
					rubric: "Did it merge?",
					checks: [{ id: "c", about: "merge ran", pass: false }],
					judge: { pass: false, reason: "skipped merge" },
				})
			: read(input, init)) as typeof fetch;
	const opened: string[] = [];
	const view = render(
		<EvalScenarioTable
			agents={agents()}
			onOpenBatch={(batch) => opened.push(batch)}
			feed={feed}
		/>,
	);
	fireEvent.click(
		await waitFor(() => view.getByRole("button", { name: "Details of a/one" })),
	);
	await waitFor(() => expect(view.getByText("Merge this for me")).toBeTruthy());
	expect(view.getByText("Did it merge?")).toBeTruthy();
	expect(view.getByText("merge ran")).toBeTruthy();
	expect(view.getByText("on claude opus high")).toBeTruthy();
	expect(view.queryByText("Latest report")).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "Open report" }));
	expect(opened).toEqual(["batch-1"]);
	fireEvent.click(view.getByRole("button", { name: "History" }));
	expect(view.getByRole("button", { name: "Hide history" })).toBeTruthy();
});

it("says a scenario never run has nothing to show yet", async () => {
	serve([]);
	const view = render(
		<EvalScenarioTable agents={agents()} onOpenBatch={() => {}} feed={feed} />,
	);
	fireEvent.click(
		await waitFor(() => view.getByRole("button", { name: "Details of a/two" })),
	);
	expect(view.getByText(/This has not run yet/)).toBeTruthy();
});

const feed = {
	conversations: [],
	events: { on: () => () => undefined },
	put: () => undefined,
	send: () => ({ id: "m1" }),
	answered: () => undefined,
	refused: () => undefined,
} as unknown as ConversationFeed;

function agents(): EvalAgentsEditor {
	return new EvalAgentsEditor({
		read: async () => ({
			agents: [{ agent: "claude", model: "opus", effort: "high" }],
			problem: null,
			roster: [],
		}),
		save: async () => {
			throw new Error("not saved");
		},
	} as never);
}

function serve(posts: string[]): void {
	globalThis.fetch = (async (input, init) => {
		const url = String(input);
		if (init?.method === "POST") {
			posts.push(String(init.body ?? ""));
		}
		if (url.includes("/api/evals/scenarios")) {
			return Response.json([
				{ id: "a/one", skill: "a", group: null, about: "About one" },
				{ id: "a/two", skill: "a", group: null, about: null },
			]);
		}
		if (url.includes("/api/evals/states")) {
			return Response.json([
				{
					scenario: "a/one",
					state: "failing",
					targets: [{ target: "claude:opus@high", passed: 2, total: 3 }],
					lastRunAt: "2026-01-01T00:00:00Z",
					run: "batch-1#r1",
				},
			]);
		}
		if (url.includes("/api/evals/run")) {
			return Response.json({ judge: { pass: false, reason: "skipped merge" } });
		}
		if (url === "/api/conversations/auto") {
			return Response.json({ id: "c1" });
		}
		if (url.includes("/prompt")) {
			return Response.json({ id: "c1" });
		}
		return Response.json([]);
	}) as typeof fetch;
}

it("opens an existing scenario loop rather than offering another run", async () => {
	const posts: string[] = [];
	serve(posts);
	const conversation = {
		id: "existing",
		archived: false,
		status: "running",
		ask: null,
		messages: [
			{
				role: "user",
				parts: [{ type: "text", text: "[SPLATES EVAL LOOP scenario a/two]" }],
			},
		],
	} as ConversationState;
	const view = render(
		<EvalScenarioTable
			agents={agents()}
			onOpenBatch={() => {}}
			feed={{ ...feed, conversations: [conversation] } as ConversationFeed}
		/>,
	);
	const button = await waitFor(() =>
		view.getByRole("button", { name: "Open loop for a/two" }),
	);
	expect(button.textContent).toContain("Loop running");
	fireEvent.click(button);
	expect(location.hash).toBe("#conversations/existing");
	expect(posts).toEqual([]);
});

it("resolves a run loop to its scenario and shows that it waits on the user", async () => {
	serve([]);
	const read = globalThis.fetch;
	globalThis.fetch = (async (input, init) =>
		String(input).includes("/api/evals/run")
			? Response.json({ scenario: "a/two" })
			: read(input, init)) as typeof fetch;
	const conversation = {
		id: "run-loop",
		archived: false,
		status: "idle",
		ask: null,
		messages: [
			{
				role: "user",
				parts: [{ type: "text", text: "[SPLATES EVAL LOOP old-run]" }],
			},
		],
	} as ConversationState;
	const view = render(
		<EvalScenarioTable
			agents={agents()}
			onOpenBatch={() => {}}
			feed={{ ...feed, conversations: [conversation] } as ConversationFeed}
		/>,
	);
	const button = await waitFor(() =>
		view.getByRole("button", { name: "Open loop for a/two" }),
	);
	expect(button.textContent).toContain("Waiting on you");
	fireEvent.click(button);
	expect(location.hash).toBe("#conversations/run-loop");
});

it("tracks a loop becoming idle and then archived through feed updates", async () => {
	serve([]);
	let changed = (): void => {};
	const conversation = {
		id: "live",
		archived: false,
		status: "running",
		ask: null,
		messages: [
			{
				role: "user",
				parts: [{ type: "text", text: "[SPLATES EVAL LOOP scenario a/two]" }],
			},
		],
	} as ConversationState;
	const live = {
		...feed,
		conversations: [conversation],
		events: {
			on: (_: string, callback: () => void) => {
				changed = callback;
				return () => {};
			},
		},
	} as unknown as ConversationFeed;
	const view = render(
		<EvalScenarioTable agents={agents()} onOpenBatch={() => {}} feed={live} />,
	);
	await waitFor(() =>
		expect(
			view.getByRole("button", { name: "Open loop for a/two" }).textContent,
		).toContain("Loop running"),
	);
	act(() => {
		live.conversations = [{ ...conversation, status: "idle" }];
		changed();
	});
	expect(
		view.getByRole("button", { name: "Open loop for a/two" }).textContent,
	).toContain("Waiting on you");
	act(() => {
		live.conversations = [{ ...conversation, archived: true }];
		changed();
	});
	expect(view.getByRole("button", { name: "Run a/two" })).toBeTruthy();
});

it("ignores finished loops and directives quoted in later messages", () => {
	const messages = (role: "user" | "agent", text: string) => ({
		role,
		parts: [{ type: "text", text }],
	});
	expect(
		loopTarget({
			archived: false,
			messages: [
				messages("user", "[SPLATES EVAL LOOP scenario a/two]"),
				messages("agent", "## ✅ Done: a/two passes"),
			],
		} as ConversationState),
	).toBeNull();
	expect(
		loopTarget({
			archived: false,
			messages: [
				messages("user", "Discuss evals"),
				messages("user", "[SPLATES EVAL LOOP scenario a/two]"),
			],
		} as ConversationState),
	).toBeNull();
});
