import { afterEach, describe, expect, it } from "bun:test";
import type {
	AssumptionView,
	RuleSuggestionView,
	TrustEntry,
} from "@splates/server/trust";
import { TRUST_ACTIONS } from "@splates/server/trust/browser";
import { cleanup, fireEvent, render, waitFor, within } from "./testing-library";
import { signed } from "./trust-how-it-works";
import { bandOf, modelName, projectName, TrustPage } from "./trust-page";

describe("trust page", () => {
	const real = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = real;
		cleanup();
	});

	it("names bands, projects and models", () => {
		const counts = (total: number) => ({
			kept: total,
			amended: 0,
			overturned: 0,
			total,
		});
		expect(
			[95, 90, 89, 70, 69].map((score) =>
				bandOf({ score, mode: "dynamic", counts: counts(10) }),
			),
		).toEqual(["assume", "assume", "go", "go", "wait"]);
		// A dynamic score assumes only with 10 decisions behind it; a pinned one at once.
		expect(bandOf({ score: 95, mode: "dynamic", counts: counts(9) })).toBe(
			"go",
		);
		expect(bandOf({ score: 95, mode: "static", counts: counts(0) })).toBe(
			"assume",
		);
		expect(projectName("/code/mono/")).toBe("mono");
		expect(modelName({ project: "", agent: "claude", model: "Opus 4.6" })).toBe(
			"Claude Opus 4.6",
		);
		expect(modelName({ project: "", agent: "codex", model: null })).toBe(
			"Codex",
		);
	});

	it("groups models by project and filters by a project chip", async () => {
		serve();
		const page = render(<TrustPage />);
		const mono = await page.findByRole("region", { name: "mono" });
		expect(within(mono).getByText("2 models")).toBeTruthy();
		expect(within(mono).getAllByText("Ask & go")).toHaveLength(2);
		expect(page.getByRole("region", { name: "vexml" })).toBeTruthy();
		fireEvent.click(page.getByRole("button", { name: "vexml" }));
		expect(page.queryByRole("region", { name: "mono" })).toBeNull();
		fireEvent.click(page.getByRole("button", { name: "All projects" }));
		expect(page.getByRole("region", { name: "mono" })).toBeTruthy();
	});

	it("sets a dynamic model's value, pins it static, sets its value, and resets it to 50", async () => {
		const { puts } = serve();
		const page = render(<TrustPage />);
		const mono = await page.findByRole("region", { name: "mono" });
		const card = within(mono).getByRole("article", { name: "Claude Opus 4.6" });
		fireEvent.click(within(card).getByRole("button", { expanded: false }));
		const value = within(card).getByRole("spinbutton", { name: "trust value" });
		expect((value as HTMLInputElement).disabled).toBe(false);
		expect(within(card).getByText("Visual / UI")).toBeTruthy();

		fireEvent.change(value, { target: { value: "74" } });
		fireEvent.keyDown(value, { key: "Enter" });
		await waitFor(() => expect(puts.length).toBe(1));

		fireEvent.click(within(card).getByRole("button", { name: "static" }));
		await waitFor(() => expect(puts.length).toBe(2));
		fireEvent.change(value, { target: { value: "95" } });
		fireEvent.keyDown(value, { key: "Enter" });
		await waitFor(() => expect(within(card).getByText("Assume")).toBeTruthy());

		fireEvent.click(within(card).getByRole("button", { name: "Reset" }));
		fireEvent.click(within(card).getByRole("button", { name: "Reset" }));
		await waitFor(() => expect(puts.length).toBe(4));
		await waitFor(() => expect((value as HTMLInputElement).value).toBe("50"));
		expect(puts).toEqual([
			{
				project: "/code/mono",
				agent: "claude",
				model: "Opus 4.6",
				mode: "dynamic",
				value: 74,
			},
			{
				project: "/code/mono",
				agent: "claude",
				model: "Opus 4.6",
				mode: "static",
				value: 74,
			},
			{
				project: "/code/mono",
				agent: "claude",
				model: "Opus 4.6",
				mode: "static",
				value: 95,
			},
			{
				project: "/code/mono",
				agent: "claude",
				model: "Opus 4.6",
				reset: true,
			},
		]);
	});

	it("logs assumptions, overturning an open one in its conversation and marking a finished one wrong", async () => {
		const { posted } = serve();
		const page = render(<TrustPage />);
		await page.findByRole("region", { name: "mono" });
		fireEvent.click(page.getByRole("tab", { name: "Assumptions" }));
		const log = await page.findByRole("list", { name: "assumptions" });
		const open = within(log).getByRole("listitem", { name: "Retry limit: 3" });
		const merged = within(log).getByRole("listitem", { name: "Status: 409" });
		const done = within(log).getByRole("listitem", { name: "Margin: 48px" });
		expect(open.textContent).toContain("Alternative: 5");
		expect(within(done).getByText("36px")).toBeTruthy();
		expect(within(done).queryByRole("button")).toBeNull();
		expect(page.getByText("Page 1 of 1 · 3 assumptions")).toBeTruthy();

		fireEvent.click(within(merged).getByRole("button", { name: "Mark wrong" }));
		await waitFor(() =>
			expect(posted).toContainEqual({
				path: "/api/trust/assumptions/wrong",
				body: { id: "assumed:c2:1" },
			}),
		);
		fireEvent.click(within(open).getByRole("button", { name: "Overturn" }));
		await waitFor(() =>
			expect(within(open).getByText("Sent to agent")).toBeTruthy(),
		);
		expect(posted).toContainEqual({
			path: "/api/conversations/c1/prompt?project=mono",
			body: { text: "[SPLATES OVERTURN 2] Retry limit: 3 → 5" },
		});
	});

	it("keys what changes trust and what each band allows, from the server's table", async () => {
		serve();
		const page = render(<TrustPage />);
		await page.findByRole("region", { name: "mono" });
		fireEvent.click(page.getByRole("tab", { name: "How it works" }));
		const weights = page.getByRole("region", { name: "What changes trust" });
		const raises = within(weights).getByRole("region", { name: "Raises it" });
		const lowers = within(weights).getByRole("region", { name: "Lowers it" });
		const alone = within(weights).getByRole("region", {
			name: "Leaves it alone",
		});
		expect(within(raises).getAllByText("+1")).toHaveLength(3);
		expect(within(lowers).getAllByText("−2")).toHaveLength(3);
		expect(within(lowers).getAllByText("−3")).toHaveLength(3);
		expect(within(alone).getAllByText("0")).toHaveLength(4);
		expect(
			within(alone).getByText("A pick or plan is taken with changes"),
		).toBeTruthy();

		const bands = page.getByRole("region", { name: "What each band allows" });
		expect(within(bands).getAllByText("Enforced")).toHaveLength(
			TRUST_ACTIONS.filter((each) => each.enforced).length,
		);
		expect(within(bands).getAllByText("Agents follow")).toHaveLength(
			TRUST_ACTIONS.filter((each) => !each.enforced).length,
		);
		const wait = within(bands).getByRole("region", { name: "Ask & wait" });
		expect(within(wait).getByText("below 70")).toBeTruthy();
		expect(
			within(wait).getByText("Merges only after you approve the plan"),
		).toBeTruthy();
		expect(
			within(bands).getByText("90 and up, after 10 decisions"),
		).toBeTruthy();
		// The key shows no standings: those live on the Models tab.
		expect(within(bands).getByRole("img").getAttribute("aria-label")).toBe(
			"Trust bands from 0 to 100: Ask & wait from 0, Ask & go from 70, Assume from 90",
		);
		expect(within(bands).queryByText(/Opus/)).toBeNull();
		expect(page.getByText(/worth about 6 decisions/)).toBeTruthy();
	});

	it("signs weights with a true minus", () => {
		expect([1, -2, 0].map(signed)).toEqual(["+1", "−2", "0"]);
	});

	it("lists pending rule suggestions with their corrections, filters by project, and queues or dismisses tasks", async () => {
		const { queued, deleted } = serve();
		const page = render(<TrustPage />);
		const section = await page.findByRole("region", {
			name: "Rule suggestions",
		});
		const monoCard = within(section).getByRole("article", {
			name: "Write down a rule for: Place export near the score?",
		});
		expect(
			within(monoCard).getByText("mono · 3 corrections · Task #241"),
		).toBeTruthy();
		expect(
			within(monoCard).getByText("Place export near the score?"),
		).toBeTruthy();
		expect(
			within(monoCard).getAllByText(
				"Agent picked Score toolbar · User chose File menu",
			),
		).toHaveLength(3);
		expect(within(monoCard).getByText("Nov 18")).toBeTruthy();

		// Filtering to vexml hides mono's suggestion and shows vexml's.
		fireEvent.click(page.getByRole("button", { name: "vexml" }));
		expect(
			page.queryByRole("article", {
				name: "Write down a rule for: Place export near the score?",
			}),
		).toBeNull();
		const vexmlCard = page.getByRole("article", {
			name: "Write down a rule for: Align dynamics to noteheads?",
		});
		expect(within(vexmlCard).getByText("1 correction · Task #19")).toBeTruthy();

		// Dismissing removes the Backlog task in its project and drops the card.
		fireEvent.click(within(vexmlCard).getByRole("button", { name: "Dismiss" }));
		await waitFor(() =>
			expect(
				page.queryByRole("article", {
					name: "Write down a rule for: Align dynamics to noteheads?",
				}),
			).toBeNull(),
		);
		expect(deleted).toEqual(["/api/todos/19?project=vexml"]);

		// Switch back to All projects and queue mono's suggestion task.
		fireEvent.click(page.getByRole("button", { name: "All projects" }));
		const remaining = await page.findByRole("article", {
			name: "Write down a rule for: Place export near the score?",
		});
		fireEvent.click(
			within(remaining).getByRole("button", { name: "Queue task" }),
		);
		await waitFor(() =>
			expect(
				page.queryByRole("region", { name: "Rule suggestions" }),
			).toBeNull(),
		);
		expect(queued).toEqual([
			{ path: "/api/todos/241/queued?project=mono", body: { queued: true } },
		]);
	});
});

function entry(
	over: Partial<TrustEntry> & Pick<TrustEntry, "project" | "score">,
): TrustEntry {
	return {
		agent: "claude",
		model: null,
		dynamicScore: over.score,
		mode: "dynamic",
		staticValue: null,
		resetAt: null,
		counts: { kept: 10, amended: 0, overturned: 1, total: 11 },
		kinds: [
			{
				kind: "visual",
				score: 74,
				counts: { kept: 4, amended: 0, overturned: 1, total: 5 },
			},
		],
		lastAt: null,
		...over,
	};
}

/**
 * Answers the page's reads with three models across two projects, and its
 * changes as the server would, answering with the puts it was sent.
 */
function serve(): {
	puts: Record<string, unknown>[];
	posted: { path: string; body: unknown }[];
	queued: { path: string; body: unknown }[];
	deleted: string[];
} {
	const puts: Record<string, unknown>[] = [];
	const posted: { path: string; body: unknown }[] = [];
	const queued: { path: string; body: unknown }[] = [];
	const deleted: string[] = [];
	const suggestions: RuleSuggestionView[] = [
		{
			project: "/code/mono",
			slug: "mono",
			taskId: 241,
			subject: "Write down a rule for: Place export near the score?",
			createdAt: "2026-11-24T12:00:00.000Z",
			corrections: [
				{
					id: "d1",
					at: "2026-11-18T12:00:00.000Z",
					subject: "Place export near the score?",
					picked: "Score toolbar",
					instead: "File menu",
					agent: "claude",
					model: "Opus 4.6",
					task: null,
					conversation: "c1",
				},
				{
					id: "d2",
					at: "2026-11-20T12:00:00.000Z",
					subject: "Where should score export live?",
					picked: "Score toolbar",
					instead: "File menu",
					agent: "claude",
					model: "Opus 4.6",
					task: null,
					conversation: "c2",
				},
				{
					id: "d3",
					at: "2026-11-24T12:00:00.000Z",
					subject: "Move score export to the toolbar?",
					picked: "Score toolbar",
					instead: "File menu",
					agent: "codex",
					model: "GPT-5.4",
					task: null,
					conversation: "c3",
				},
			],
		},
		{
			project: "/code/vexml",
			slug: "vexml",
			taskId: 19,
			subject: "Write down a rule for: Align dynamics to noteheads?",
			createdAt: "2026-11-23T12:00:00.000Z",
			corrections: [
				{
					id: "v1",
					at: "2026-11-22T12:00:00.000Z",
					subject: "Align dynamics to noteheads?",
					picked: "Left edge",
					instead: "Notehead center",
					agent: "claude",
					model: "Opus 4.6",
					task: null,
					conversation: "c4",
				},
			],
		},
	];
	const assumed = (
		over: Partial<AssumptionView> &
			Pick<AssumptionView, "id" | "assumed" | "alternative">,
	): AssumptionView => ({
		number: 1,
		at: new Date().toISOString(),
		project: "/code/mono",
		agent: "claude",
		model: "Opus 4.6",
		kind: "defaults",
		conversation: "c1",
		task: "retry-scans",
		overturned: null,
		open: false,
		...over,
	});
	const assumptions = [
		assumed({
			id: "assumed:c1:2",
			number: 2,
			assumed: "Retry limit: 3",
			alternative: "5",
			open: true,
		}),
		assumed({
			id: "assumed:c2:1",
			conversation: "c2",
			kind: "design",
			assumed: "Status: 409",
			alternative: "400",
		}),
		assumed({
			id: "assumed:c3:1",
			conversation: "c3",
			project: "/code/vexml",
			assumed: "Margin: 48px",
			alternative: "36px",
			overturned: { at: new Date().toISOString(), instead: "36px" },
		}),
	];
	const entries = [
		entry({ project: "/code/mono", model: "Opus 4.6", score: 86 }),
		entry({
			project: "/code/mono",
			agent: "codex",
			model: "GPT-5.4",
			score: 80,
			mode: "static",
		}),
		entry({ project: "/code/vexml", model: "Opus 4.6", score: 58 }),
	];
	globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
		const url = new URL(String(input), "http://page");
		if (init?.method === "DELETE") {
			deleted.push(`${url.pathname}${url.search}`);
			return new Response(null, { status: 204 });
		}
		if (init?.method === "POST") {
			const body =
				init.body instanceof FormData
					? Object.fromEntries(init.body.entries())
					: JSON.parse(String(init.body));
			posted.push({ path: `${url.pathname}${url.search}`, body });
			return Response.json({ recorded: true });
		}
		if (url.pathname === "/api/projects") {
			return Response.json({
				projects: [
					{ slug: "mono", root: "/code/mono" },
					{ slug: "vexml", root: "/code/vexml" },
				],
			});
		}
		if (url.pathname === "/api/trust/assumptions") {
			return Response.json({ assumptions, total: 3, page: 1, pages: 1 });
		}
		if (url.pathname === "/api/trust/suggestions") {
			return Response.json({ suggestions });
		}
		if (init?.method === "PUT" && url.pathname.endsWith("/queued")) {
			const body = JSON.parse(String(init.body));
			queued.push({ path: `${url.pathname}${url.search}`, body });
			return new Response(null, { status: 204 });
		}
		if (init?.method !== "PUT") {
			return Response.json({ entries });
		}
		const body = JSON.parse(String(init.body)) as Record<string, unknown>;
		puts.push(body);
		const next = {
			...entries.find(
				(each) => each.project === body.project && each.model === body.model,
			),
		} as TrustEntry;
		if (body.mode === "static") {
			Object.assign(next, { mode: "static", score: body.value });
		}
		if (body.mode === "dynamic") {
			const score =
				typeof body.value === "number" ? body.value : next.dynamicScore;
			Object.assign(next, { mode: "dynamic", dynamicScore: score, score });
		}
		if (body.reset === true) {
			Object.assign(next, { mode: "dynamic", dynamicScore: 50, score: 50 });
		}
		return Response.json({ entry: next });
	}) as unknown as typeof fetch;
	return { puts, posted, queued, deleted };
}
