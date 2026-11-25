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

it("lists specs as sentences under their suite and group, every group its own card", async () => {
	serve([]);
	const view = render(
		<EvalScenarioTable file="suite" agents={agents()} feed={feed} />,
	);
	await waitFor(() =>
		expect(view.getByText("0 of 3 specs passing")).toBeTruthy(),
	);
	expect(view.getByRole("button", { name: "does one" })).toBeTruthy();
	expect(view.queryByText("a/one")).toBeNull();
	expect(view.queryByText("Long requirement")).toBeNull();
	expect(view.getByRole("button", { name: "does three" })).toBeTruthy();
	fireEvent.click(view.getByRole("button", { name: "Show only failing" }));
	expect(view.queryByRole("button", { name: "does two" })).toBeNull();
});

it("lists the eval files as rows opening their own pages, with no specs or Run button", async () => {
	serve([]);
	const view = render(<EvalScenarioTable agents={agents()} feed={feed} />);
	const row = await waitFor(() => view.getByRole("link", { name: /suite/ }));
	expect(row.getAttribute("href")).toBe("#evals/file/suite");
	expect(row.textContent).toContain("3 specs");
	expect(
		view.getByRole("img", { name: "1 failing, 0 passing, 2 not run" }),
	).toBeTruthy();
	expect(view.queryByRole("button", { name: "does one" })).toBeNull();
	expect(view.queryByRole("button", { name: "Pick specs to run" })).toBeNull();
});

it("reviews the selected scenarios before starting, and starts each", async () => {
	const posts: string[] = [];
	serve(posts);
	const view = render(
		<EvalScenarioTable file="suite" agents={agents()} feed={feed} />,
	);
	fireEvent.click(
		await waitFor(() => view.getByRole("checkbox", { name: "Select suite" })),
	);
	fireEvent.click(view.getByRole("button", { name: "Review 3 specs" }));
	expect(view.queryByLabelText("Budget in dollars")).toBeNull();
	expect(view.queryByLabelText("Run repetitions")).toBeNull();
	expect(view.getByText(/Accepting creates 1 conversation,/)).toBeTruthy();
	expect(posts).toEqual([]);
	fireEvent.click(view.getByRole("button", { name: "Back" }));
	fireEvent.click(view.getByRole("button", { name: "Review 3 specs" }));
	fireEvent.click(view.getByRole("button", { name: "Accept and start evals" }));
	await waitFor(() =>
		expect(posts.filter((post) => post.includes('"words"'))).toHaveLength(1),
	);
	const plans = posts
		.filter((post) => post.includes('"words"'))
		.map((post) => JSON.parse(post).words);
	expect(plans).toHaveLength(1);
	expect(plans[0]).toContain(
		"[SPLATES EVAL LOOP scenarios a/one a/two a/three]",
	);
	expect(plans[0]).not.toContain("Budget");
	expect(plans[0]).not.toContain("Repetitions:");
	expect(plans[0]).toContain("Agents: `claude:opus@high`");
});

it("opens a spec to its proposal card's environment, example and checks, with a link to its runs", async () => {
	serve([]);
	const view = render(
		<EvalScenarioTable file="suite" agents={agents()} feed={feed} />,
	);
	fireEvent.click(
		await waitFor(() => view.getByRole("button", { name: "does one" })),
	);
	const environment = view.getByRole("region", { name: "Environment" });
	// One line of words and code, not a stack of them.
	expect(environment.querySelector("p")?.textContent).toBe(
		"A repo with users.ts",
	);
	const example = view.getByRole("figure", { name: "Example conversation" });
	expect(example.textContent).toContain("Do one");
	expect(example.textContent).toContain("Starts the task");
	expect(example.textContent).toContain("Here is the plan");
	expect(view.getByText("Asks first")).toBeTruthy();
	expect(view.getByText("Checks · 2")).toBeTruthy();
	expect(view.getByText("Is the plan short?")).toBeTruthy();
	expect(view.queryByText("baseline 1b72136")).toBeNull();
	expect(
		view
			.getByRole("link", { name: /All runs on its test page/ })
			.getAttribute("href"),
	).toBe("#evals/batch-1/test/a%2Fone/batch-1%23r1");
	expect(view.getByText(/^Last run /)).toBeTruthy();
});

it("says a spec no batch ran has nothing to show yet", async () => {
	serve([]);
	const view = render(
		<EvalScenarioTable file="suite" agents={agents()} feed={feed} />,
	);
	fireEvent.click(
		await waitFor(() => view.getByRole("button", { name: "does two" })),
	);
	expect(view.getByText("Not run yet.")).toBeTruthy();
	expect(view.queryByRole("link", { name: /All runs/ })).toBeNull();
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
				{
					id: "a/one",
					group: null,
					about: "Long requirement",
					sentence: "does one",
					groups: ["suite", "failing group"],
					prompt: "Do one",
					checks: [{ id: "c", about: "Asks first" }],
					judge: "Is the plan short?",
					judgeWith: "claude:sonnet",
					environment: "A repo with `users.ts`",
					example: [
						{ kind: "tool", name: "Bash", input: "x", does: "Starts the task" },
						{ kind: "text", text: "Here is the plan" },
					],
				},
				{
					id: "a/two",
					group: null,
					about: null,
					sentence: "does two",
					groups: ["suite", "failing group"],
				},
				{
					id: "a/three",
					group: null,
					about: null,
					sentence: "does three",
					groups: ["suite", "quiet group"],
				},
			]);
		}
		if (url.includes("/api/evals/states")) {
			return Response.json([
				{
					scenario: "a/one",
					state: "failing",
					targets: [
						{ target: "claude/opus@high", passed: 2, total: 3 },
						{ target: "claude/opus@high @1b72136f7", passed: 0, total: 3 },
					],
					lastRunAt: "2026-01-01T00:00:00Z",
					run: "batch-1#r1",
					batch: "batch-1",
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
			file="suite"
			agents={agents()}
			feed={{ ...feed, conversations: [conversation] } as ConversationFeed}
		/>,
	);
	const button = await waitFor(() =>
		view.getByRole("button", { name: "Open loop for does two" }),
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
			file="suite"
			agents={agents()}
			feed={{ ...feed, conversations: [conversation] } as ConversationFeed}
		/>,
	);
	const button = await waitFor(() =>
		view.getByRole("button", { name: "Open loop for does two" }),
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
		<EvalScenarioTable file="suite" agents={agents()} feed={live} />,
	);
	await waitFor(() =>
		expect(
			view.getByRole("button", { name: "Open loop for does two" }).textContent,
		).toContain("Loop running"),
	);
	act(() => {
		live.conversations = [{ ...conversation, status: "idle" }];
		changed();
	});
	expect(
		view.getByRole("button", { name: "Open loop for does two" }).textContent,
	).toContain("Waiting on you");
	act(() => {
		live.conversations = [{ ...conversation, archived: true }];
		changed();
	});
	expect(
		view.queryByRole("button", { name: "Open loop for does two" }),
	).toBeNull();
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

it("picks all of a group with its checkbox", async () => {
	serve([]);
	const view = render(
		<EvalScenarioTable file="suite" agents={agents()} feed={feed} />,
	);
	await waitFor(() => view.getByRole("button", { name: "does one" }));
	fireEvent.click(view.getByRole("checkbox", { name: "Select failing group" }));
	expect(view.getByRole("button", { name: "Review 2 specs" })).toBeTruthy();
});

it("reads a loop over several scenarios", () => {
	expect(
		loopTarget({
			archived: false,
			messages: [
				{
					role: "user",
					parts: [
						{ type: "text", text: "[SPLATES EVAL LOOP scenarios a/one a/two]" },
					],
				},
			],
		} as ConversationState),
	).toEqual({ scenarios: ["a/one", "a/two"] });
});
