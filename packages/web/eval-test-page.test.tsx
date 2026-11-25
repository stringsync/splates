import "./testing-dom";
import { afterEach, expect, it } from "bun:test";
import { EvalTestPage } from "./eval-test-page";
import { EvalsPage } from "./evals-page";
import { act, cleanup, fireEvent, render, waitFor } from "./testing";

it("lists runs by model, folds the clean model, and shows grading and diagnosis for the failing run", async () => {
	serve();
	const picked: string[] = [];
	const view = render(
		<EvalTestPage
			batch="b"
			scenario="asks"
			run={null}
			onEvals={() => undefined}
			onPick={(run) => picked.push(run)}
			onRound={() => undefined}
		/>,
	);
	expect(await view.findByText("Diagnosis")).toBeTruthy();
	expect(view.getByText("The trigger misses webhook URLs.")).toBeTruthy();
	expect(view.getByText(/Proposed remedy/)).toBeTruthy();
	expect(view.getByText("Grading")).toBeTruthy();
	expect(view.getByText(/2 runs passed/)).toBeTruthy();
	expect(view.getByText("1/2")).toBeTruthy();
	expect(view.queryByRole("button", { name: "Failed" })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: /Run 1/ }));
	expect(picked).toEqual(["b#claude-0"]);
});

it("steps between rounds with the header round control and opens runs in a drawer", async () => {
	serve([
		{
			id: "a",
			conversation: "c",
			startedAt: "2026-11-03T12:00:00Z",
		},
		{
			id: "b",
			conversation: "c",
			startedAt: "2026-11-04T12:00:00Z",
		},
	]);
	const picked: string[] = [];
	const rounds: string[] = [];
	const view = render(
		<EvalTestPage
			batch="b"
			scenario="asks"
			run={null}
			onEvals={() => undefined}
			onPick={(run) => picked.push(run)}
			onRound={(batch) => rounds.push(batch)}
		/>,
	);
	expect(
		await view.findByRole("button", { name: "Choose round" }),
	).toBeTruthy();
	expect(view.getByRole("button", { name: "Choose round" }).textContent).toBe(
		"Round 2 of 2",
	);
	expect(
		(view.getByRole("button", { name: "Next round" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	fireEvent.click(view.getByRole("button", { name: "Previous round" }));
	expect(rounds).toEqual(["a"]);

	fireEvent.click(view.getByRole("button", { name: "Open runs" }));
	const dialog = await view.findByRole("dialog");
	expect(dialog.textContent).toContain("Runs");
	const drawerRunButtons = Array.from(dialog.querySelectorAll("button")).filter(
		(button) => button.textContent?.includes("Run 1"),
	);
	const firstRunButton = drawerRunButtons[0];
	expect(firstRunButton).toBeDefined();
	if (firstRunButton !== undefined) {
		fireEvent.click(firstRunButton);
	}
	expect(picked).toEqual(["b#claude-0"]);
	await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
});

it("keeps the page mounted without flashing when switching rounds, caches visited rounds, and jumps from the dropdown", async () => {
	let resolveRoundA: ((response: Response) => void) | null = null;
	const calls: string[] = [];
	const batches = [
		{ id: "a", conversation: "c", startedAt: "2026-11-03T12:00:00Z" },
		{ id: "b", conversation: "c", startedAt: "2026-11-04T12:00:00Z" },
	];
	const makeGrid = (id: string, diagnosis: string) => ({
		id,
		skill: "splates",
		producer: "splates",
		startedAt: id === "a" ? "2026-11-03T12:00:00Z" : "2026-11-04T12:00:00Z",
		targets: [target("claude")],
		tally: { pass: 0, fail: 1 },
		cells: 1,
		tokens: 100,
		costUsd: 0.1,
		grid: [
			{
				scenario: "asks",
				aspect: "",
				requirement: "",
				target: "claude",
				repetition: 0,
				run: {
					id: `${id}#claude-0`,
					status: "fail" as const,
					tokens: 100,
					costUsd: 0.1,
					milliseconds: 12000,
				},
			},
		],
		results: [
			{
				scenario: "asks",
				target: "claude",
				passed: 0,
				graded: 1,
				errored: 0,
				firstFailed: `${id}#claude-0`,
				failures: [
					{
						kind: "diagnosed",
						runs: [`${id}#claude-0`],
						check: "creds",
						causes: ["skill"],
						why: diagnosis,
						did: null,
						remedy: null,
					},
				],
			},
		],
	});
	globalThis.fetch = ((input: RequestInfo | URL) => {
		const url = String(input);
		calls.push(url);
		if (url.endsWith("/api/evals")) {
			return Promise.resolve(Response.json(batches));
		}
		if (url.includes("/api/evals/batch?id=a")) {
			return new Promise<Response>((resolve) => {
				resolveRoundA = resolve;
			});
		}
		if (url.includes("/api/evals/batch?id=b")) {
			return Promise.resolve(Response.json(makeGrid("b", "Round B failure.")));
		}
		if (url.includes("/api/evals/run")) {
			const id = new URL(url, "http://localhost").searchParams.get("id") ?? "";
			return Promise.resolve(
				Response.json({
					id,
					status: "fail",
					tokens: 100,
					costUsd: 0.1,
					milliseconds: 12000,
					producer: "splates",
					scenario: "asks",
					aspect: "",
					requirement: "",
					target: target("claude"),
					repetition: 0,
					input: "Hook up the webhook.",
					rubric: null,
					checks: [
						{
							id: "creds",
							about: "asks through creds",
							pass: false,
							error: "asked in chat",
						},
					],
					judge: null,
					reply: "Paste the URL here.",
					transcript: [],
				}),
			);
		}
		return Promise.resolve(Response.json([]));
	}) as typeof fetch;

	let currentBatch = "b";
	const view = render(
		<EvalsPage
			open={{ batch: currentBatch, run: null, plan: null, test: "asks" }}
			onOpen={(nextBatch) => {
				if (nextBatch !== null) {
					currentBatch = nextBatch;
					view.rerender(
						<EvalsPage
							open={{
								batch: currentBatch,
								run: null,
								plan: null,
								test: "asks",
							}}
							onOpen={(again) => {
								if (again !== null) {
									currentBatch = again;
								}
							}}
						/>,
					);
				}
			}}
		/>,
	);

	expect(await view.findByText("Round B failure.")).toBeTruthy();
	const trigger = await view.findByRole("button", { name: "Choose round" });
	expect(trigger.textContent).toBe("Round 2 of 2");

	// Open the round dropdown and jump to Round 1.
	await act(async () => {
		fireEvent.click(trigger);
	});
	const items = await view.findAllByRole("menuitemradio");
	expect(items.map((item) => item.textContent)).toEqual([
		"Round 2 (latest)",
		"Round 1",
	]);
	await act(async () => {
		fireEvent.click(items[1] as HTMLElement);
	});

	// While round A is still in flight, the previous round stays visible with no loading flash.
	expect(view.queryByText("Reading the test…")).toBeNull();
	expect(view.queryByText("Reading the run…")).toBeNull();
	expect(view.getByText("Round B failure.")).toBeTruthy();
	expect(view.getByRole("button", { name: "Choose round" }).textContent).toBe(
		"Round 1 of 2",
	);

	// Resolve round A and verify it swaps in cleanly.
	await act(async () => {
		resolveRoundA?.(Response.json(makeGrid("a", "Round A failure.")));
	});
	expect(await view.findByText("Round A failure.")).toBeTruthy();

	// Switching back to round B uses the cache and never refetches /api/evals or batch B.
	const batchBCallsBefore = calls.filter((url) =>
		url.includes("/api/evals/batch?id=b"),
	).length;
	const roundsCallsBefore = calls.filter((url) =>
		url.endsWith("/api/evals"),
	).length;
	view.rerender(
		<EvalsPage
			open={{ batch: "b", run: null, plan: null, test: "asks" }}
			onOpen={() => undefined}
		/>,
	);
	expect(await view.findByText("Round B failure.")).toBeTruthy();
	expect(
		calls.filter((url) => url.includes("/api/evals/batch?id=b")).length,
	).toBe(batchBCallsBefore);
	expect(calls.filter((url) => url.endsWith("/api/evals")).length).toBe(
		roundsCallsBefore,
	);
});

const realFetch = globalThis.fetch;
afterEach(() => {
	cleanup();
	globalThis.fetch = realFetch;
});

const target = (agent: string) => ({
	key: agent,
	agent,
	model: null,
	effort: null,
	skill: null,
});

const cell = (agent: string, repetition: number, status: "pass" | "fail") => ({
	scenario: "asks",
	aspect: "",
	requirement: "",
	target: agent,
	repetition,
	run: {
		id: `b#${agent}-${repetition}`,
		status,
		tokens: 100,
		costUsd: 0.09,
		milliseconds: 41000,
	},
});

function serve(
	batches: { id: string; conversation: string; startedAt: string }[] = [],
): void {
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.endsWith("/api/evals")) {
			return Response.json(batches);
		}
		if (url.includes("/api/evals/batch")) {
			return Response.json({
				id: "b",
				skill: "splates",
				producer: "splates",
				startedAt: "2026-11-04T12:00:00Z",
				targets: [target("claude"), target("codex")],
				tally: { pass: 3, fail: 1 },
				cells: 4,
				tokens: 400,
				costUsd: 0.4,
				grid: [
					cell("claude", 0, "pass"),
					cell("claude", 1, "fail"),
					cell("codex", 0, "pass"),
					cell("codex", 1, "pass"),
				],
				results: [
					{
						scenario: "asks",
						target: "claude",
						passed: 1,
						graded: 2,
						errored: 0,
						firstFailed: "b#claude-1",
						failures: [
							{
								kind: "diagnosed",
								runs: ["b#claude-1"],
								check: "creds",
								causes: ["skill"],
								why: "The trigger misses webhook URLs.",
								did: null,
								remedy: { text: "Name webhook URLs.", state: "proposed" },
							},
						],
					},
				],
			});
		}
		if (url.includes("/api/evals/run")) {
			return Response.json({
				id: "b#claude-1",
				status: "fail",
				tokens: 100,
				costUsd: 0.09,
				milliseconds: 41000,
				producer: "splates",
				scenario: "asks",
				aspect: "",
				requirement: "",
				target: target("claude"),
				repetition: 1,
				input: "Hook up the webhook.",
				rubric: null,
				checks: [
					{
						id: "creds",
						about: "asks through creds",
						pass: false,
						error: "asked in chat",
					},
					{ id: "env", about: "leaves env untouched", pass: true },
				],
				judge: null,
				reply: "Paste the URL here.",
				transcript: [],
			});
		}
		return Response.json([]);
	}) as typeof fetch;
}
