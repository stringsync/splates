import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
} from "./testing";

describe("App's run evals card", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("lists targeted specs as sentences with what the round may cost, and has no Run of its own", async () => {
		const launches = serveUnstartedEval({
			budget: { usd: 10, spent: 0, answers: {} },
		});
		const view = await testing.openConversations([
			conversation({
				title: "Evals",
				messages: [
					message("user", "[SPLATES EVAL LOOP scenario decisions/ask-first]"),
					...ongoing().messages,
				],
			}),
		]);
		await waitFor(() =>
			expect(view.getByTestId("plan").textContent).toBe("Up to $1.00"),
		);
		expect(view.getByText("Ask first")).toBeTruthy();
		expect(view.getByText("1 other spec not targeted")).toBeTruthy();
		expect(view.queryByRole("button", { name: /^Run/ })).toBeNull();
		expect(view.queryByRole("button", { name: /Reject/ })).toBeNull();
		expect(view.queryByText("Waiting for a budget")).toBeNull();
		expect(launches.filter((each) => each !== "GET")).toEqual([]);
	});

	it("says it waits for a budget when the round would take the conversation past it", async () => {
		serveUnstartedEval({ budget: { usd: 10, spent: 9.6, answers: {} } });
		const view = await testing.openConversations([
			conversation({ title: "Evals", messages: ongoing().messages }),
		]);
		await waitFor(() =>
			expect(view.getByText("Waiting for a budget")).toBeTruthy(),
		);
		expect(
			view.getByText(/\$0\.40 of the \$10 eval budget is left\./),
		).toBeTruthy();
	});

	it("says no budget is approved yet before the first budget card", async () => {
		serveUnstartedEval({ budget: { usd: 0, spent: 0, answers: {} } });
		const view = await testing.openConversations([
			conversation({ title: "Evals", messages: ongoing().messages }),
		]);
		await waitFor(() =>
			expect(
				view.getByText(/No eval budget is approved in this conversation yet\./),
			).toBeTruthy(),
		);
	});

	it("opens an ongoing run on its progress, with Stop", async () => {
		let arrive = () => {};
		const reading = new Promise<void>((resolve) => {
			arrive = resolve;
		});
		serveOngoingEval(reading);
		const asking = conversation({
			title: "Evals",
			messages: [
				message(
					"agent",
					"## 🔐 Permission: run evals splates: the decision probes\n\nChecks the ask-first rule.\n\n- `decisions/ask-first`",
				),
			],
		});

		const view = await testing.openConversations([asking]);
		expect(view.queryByLabelText("Loading evals")).toBeNull();
		expect(view.getByText("decisions/ask-first")).toBeTruthy();

		await act(async () => arrive());
		await waitFor(() =>
			expect(view.getByTestId("eval-timer").textContent).toContain("2 of 4"),
		);
		expect(
			view.getAllByRole("img", { name: /decisions\/ask-first/ }),
		).toHaveLength(4);
		expect(view.getByText("Running evals · round 1")).toBeTruthy();
		expect(view.queryByText("Run splates evals")).toBeNull();
		expect(view.getByRole("button", { name: "Stop" })).toBeTruthy();
	});

	it("keeps scenario squares and 0-of-N progress once the server starts the round, before the batch lands", async () => {
		serveUnstartedEval({
			launch: {
				id: "launch-1",
				key: "run-key",
				status: "running",
				batch: null,
				output: "",
				auto: true,
			},
		});
		const view = await testing.openConversations([ongoing()]);
		await waitFor(() =>
			expect(view.getByText("Running evals · round 1")).toBeTruthy(),
		);
		expect(view.getByTestId("eval-timer").textContent).toContain("0 of 1");
		expect(
			view.getAllByRole("img", {
				name: /decisions\/ask-first on claude.*running/,
			}),
		).toHaveLength(1);
		expect(view.queryByRole("link", { name: "Open the report" })).toBeNull();
	});

	it("renders done evals as spec rows that open to Prompt, Results, Where it failed, diagnosis and remedy", async () => {
		serveOngoingEval(Promise.resolve(), {
			status: "done",
			remarks: "",
			failed: true,
		});
		const view = await testing.openConversations([ongoing()]);
		await waitFor(() =>
			expect(view.getByText("Evals done · round 1")).toBeTruthy(),
		);
		expect(view.getByText("1 failing")).toBeTruthy();
		expect(view.getByText("33%")).toBeTruthy();
		expect(view.getByText("1 fix proposed")).toBeTruthy();
		expect(
			view.getByRole("link", { name: "View test results ›" }),
		).toBeTruthy();

		// Open the test row.
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Ask first/ })),
		);
		expect(view.getByText("Prompt")).toBeTruthy();
		expect(view.getByText("“Should we add dark mode?”")).toBeTruthy();
		expect(view.getByText("Results")).toBeTruthy();
		expect(view.getByText("Where it failed")).toBeTruthy();
		// Failure row starts collapsed.
		const failureRow = view.getByRole("button", { name: /Codex.*run 1/ });
		expect(failureRow.getAttribute("aria-expanded")).toBe("false");

		// Open the failure row to see the run's timeline, Want/Got, diagnosis and remedy.
		await act(async () => fireEvent.click(failureRow));
		expect(failureRow.getAttribute("aria-expanded")).toBe("true");
		await waitFor(() => expect(view.getByText("Want")).toBeTruthy());
		expect(view.getByText("Read SKILL.md")).toBeTruthy();
		expect(view.getByText("Fix")).toBeTruthy();
		expect(view.getByText("Proposed")).toBeTruthy();
		expect(
			view.getByRole("link", { name: /All 4 runs on the Evals page/ }),
		).toBeTruthy();
	});

	it("keeps earlier completed eval rounds expanded when a newer round follows in the thread", async () => {
		serveOngoingEval(Promise.resolve(), {
			status: "done",
			remarks: "",
		});
		const view = await testing.openConversations([
			conversation({
				title: "Evals",
				messages: [
					message(
						"agent",
						"## 🔐 Permission: run evals splates: round one\n\n- `decisions/ask-first`",
					),
					message(
						"agent",
						"## 🔐 Permission: run evals splates: round two\n\n- `decisions/ask-first`",
					),
				],
			}),
		]);
		await waitFor(() =>
			expect(view.getByText("Evals done · round 2")).toBeTruthy(),
		);
		expect(view.getByText("Evals done · round 1")).toBeTruthy();
		// Both completed rounds stay open so their evolution stays visible.
		const round1Header = view
			.getByText("Evals done · round 1")
			.closest("header");
		expect(round1Header?.getAttribute("aria-expanded")).toBeNull();
		const round2Header = view
			.getByText("Evals done · round 2")
			.closest("header");
		expect(round2Header?.getAttribute("aria-expanded")).toBeNull();
		expect(view.getAllByRole("button", { name: /Ask first/ })).toHaveLength(2);
	});

	it("still folds an unrun earlier eval round when a newer round follows", async () => {
		serveUnstartedEval({ budget: { usd: 10, spent: 0, answers: {} } });
		const view = await testing.openConversations([
			conversation({
				title: "Evals",
				messages: [
					message(
						"agent",
						"## 🔐 Permission: run evals splates: round one\n\n- `decisions/ask-first`",
					),
					message(
						"agent",
						"## 🔐 Permission: run evals splates: round two\n\n- `decisions/ask-first`",
					),
				],
			}),
		]);
		await waitFor(() => expect(view.getByText("Not run")).toBeTruthy());
		const round1Header = view.getByText("Run splates evals").closest("header");
		expect(round1Header?.getAttribute("aria-expanded")).toBe("false");
		const round2Header = view
			.getByText("Run splates evals · round 2")
			.closest("header");
		expect(round2Header?.getAttribute("aria-expanded")).toBeNull();
	});

	it("renders inline markdown code in targeted and untargeted spec descriptions", async () => {
		serveUnstartedEval({
			budget: { usd: 10, spent: 0, answers: {} },
			scenarios: [
				{
					id: "decisions/ask-first",
					group: "decisions",
					about: "Start a task with `splates add` and update `SPLATES.md`.",
				},
				{
					id: "decisions/other",
					group: "decisions",
					about: "Land with `splates merge`.",
				},
			],
		});
		const view = await testing.openConversations([ongoing()]);
		await waitFor(() =>
			expect(view.getByText("splates add").tagName).toBe("CODE"),
		);
		expect(view.getByText("SPLATES.md").tagName).toBe("CODE");
		expect(view.container.textContent).not.toContain("`splates add`");

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: /1 other spec not targeted/ }),
			),
		);
		expect(view.getByText("splates merge").tagName).toBe("CODE");
		expect(view.container.textContent).not.toContain("`splates merge`");
	});
});

function ongoing() {
	return conversation({
		title: "Evals",
		messages: [
			message(
				"agent",
				"## 🔐 Permission: run evals splates: the decision probes\n\nChecks the ask-first rule.\n\n- `decisions/ask-first`",
			),
		],
	});
}

function serveOngoingEval(
	reading: Promise<void>,
	ended: { status: string; remarks: string; failed?: boolean } | null = null,
): void {
	const pageFetch = globalThis.fetch;
	const answer = async (body: unknown) => {
		await reading;
		return Response.json(body);
	};
	const routes = new Map<string, () => Promise<Response>>([
		[
			"/api/evals/agents",
			() => answer({ agents: [], problem: null, roster: [] }),
		],
		[
			"/api/evals/scenarios",
			() =>
				answer([
					{
						id: "decisions/ask-first",
						group: "decisions",
						about: "Ask first",
						prompt: "Should we add dark mode?",
					},
				]),
		],
		[
			"/api/evals/launch",
			() =>
				answer({
					id: "launch-1",
					key: "run-key",
					status: ended?.status ?? "running",
					batch: "batch-1",
					output: "",
					auto: true,
				}),
		],
		[
			"/api/evals/run",
			() =>
				answer({
					id: "batch-1#codex-0",
					status: "fail",
					tokens: 5,
					costUsd: 0.25,
					milliseconds: 12000,
					producer: "splates",
					scenario: "decisions/ask-first",
					aspect: "decisions",
					requirement: "Ask first",
					target: CODEX,
					repetition: 0,
					input: "Should we add dark mode?",
					rubric: null,
					checks: [
						{
							id: "asks-first",
							about: "asks in a questions card before coding",
							pass: false,
						},
					],
					judge: null,
					reply: "I went ahead and added dark mode.",
					transcript: [
						{
							kind: "tool",
							name: "Read",
							input: JSON.stringify({ file_path: "SKILL.md" }),
							output: "",
							milliseconds: 3000,
						},
					],
				}),
		],
		[
			"/api/evals/batch",
			() =>
				answer({
					id: "batch-1",
					skill: "splates",
					producer: "splates",
					startedAt: "2026-10-27T00:00:00.000Z",
					targets: [CLAUDE, CODEX],
					tally: ended?.failed
						? { pass: 1, fail: 1, pending: 2 }
						: { pass: 2, pending: 2 },
					cells: 4,
					tokens: 10,
					costUsd: 0.5,
					results: [
						{
							scenario: "decisions/ask-first",
							target: CLAUDE.key,
							passed: 1,
							graded: 1,
							errored: 0,
							firstFailed: null,
							failures: [],
						},
						{
							scenario: "decisions/ask-first",
							target: CODEX.key,
							passed: ended?.failed ? 0 : 1,
							graded: ended?.failed ? 2 : 1,
							errored: 0,
							firstFailed: ended?.failed ? "batch-1#codex-0" : null,
							failures: ended?.failed
								? [
										{
											kind: "diagnosed",
											runs: ["batch-1#codex-0"],
											check: "asks-first",
											causes: ["skill"],
											why: "Skipped the questions card and coded immediately.",
											did: { text: "coded without asking", step: null },
											remedy: {
												text: "emphasize asking before coding in step 5",
												state: "proposed",
											},
										},
									]
								: [],
						},
					],
					grid: [
						cell(CLAUDE.key, 0, "pass"),
						cell(CLAUDE.key, 1, null),
						cell(CODEX.key, 0, ended?.failed ? "fail" : "pass"),
						cell(CODEX.key, 1, null),
					],
					...(ended === null ? {} : { remarks: ended.remarks }),
				}),
		],
	]);
	globalThis.fetch = ((path: string, init?: RequestInit) => {
		const route = path.split("?")[0] ?? "";
		return routes.get(route)?.() ?? pageFetch(path, init);
	}) as typeof fetch;
}

interface ServeUnstartedEvalOptions {
	/** What `/api/evals/budget` answers; unanswered when absent. */
	budget?: {
		usd: number;
		spent: number;
		answers: Record<string, number | null>;
	};
	/** The launch the server started for the card; none when absent. */
	launch?: {
		id: string;
		key: string;
		status: string;
		batch: string | null;
		output: string;
		auto: true;
	};
	/** Scenarios returned by `/api/evals/scenarios`. */
	scenarios?: { id: string; group: string; about: string }[];
}

/** Serves a card the server has not started; answers the methods `/api/evals/launch` was called with. */
function serveUnstartedEval(opts: ServeUnstartedEvalOptions = {}): string[] {
	const pageFetch = globalThis.fetch;
	const launches: string[] = [];
	globalThis.fetch = (async (path: string, init?: RequestInit) => {
		const route = path.split("?")[0];
		if (route === "/api/evals/agents") {
			return Response.json({
				agents: [{ agent: "claude" }],
				problem: null,
				roster: [],
			});
		}
		if (route === "/api/evals/scenarios") {
			return Response.json(
				opts.scenarios ?? [
					{ id: "decisions/ask-first", group: "decisions", about: "Ask first" },
					{
						id: "decisions/other",
						group: "decisions",
						about: "Other spec",
					},
				],
			);
		}
		if (route === "/api/evals/budget" && opts.budget !== undefined) {
			return Response.json(opts.budget);
		}
		if (route === "/api/evals/plan") {
			return Response.json({ cells: 1, usd: 1, refused: false, output: "" });
		}
		if (route === "/api/evals/launch") {
			launches.push(init?.method ?? "GET");
			return Response.json(opts.launch ?? null);
		}
		return pageFetch(path, init);
	}) as typeof fetch;
	return launches;
}

const CLAUDE = {
	key: "claude/opus",
	agent: "claude",
	model: "opus",
	effort: null,
	skill: null,
};
const CODEX = { ...CLAUDE, key: "codex", agent: "codex", model: null };

function cell(
	target: string,
	repetition: number,
	status: "pass" | "fail" | null,
) {
	return {
		scenario: "decisions/ask-first",
		aspect: "decisions",
		requirement: "Ask first",
		target,
		repetition,
		run:
			status === null
				? null
				: {
						id: `batch-1#${target}-${repetition}`,
						status,
						tokens: 5,
						costUsd: 0.25,
						milliseconds: 1000,
					},
	};
}
