import { afterEach, describe, expect, it } from "bun:test";
import type {
	AssumptionView,
	RuleSuggestionView,
	TrustBand,
	TrustEntry,
	TrustScope,
} from "@splates/server/trust";
import { bandOf } from "@splates/server/trust/browser";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "./testing-library";
import { modelName, projectName, standingText, TrustPage } from "./trust-page";

describe("trust page", () => {
	const real = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = real;
		cleanup();
	});

	it("formats earned standing lines across levels, pinned state, and asking kinds", () => {
		expect(
			standingText(
				entry({
					project: "/code/mono",
					band: "ask-and-wait",
					earnedBand: "ask-and-wait",
					standing: {
						sessions: 5,
						activeDays: 2,
						agreement: 88,
						cleanStreak: 5,
						brokenInLast5: 0,
						brokenInLast10: 0,
					},
				}),
			),
		).toBe("Toward Ask & go · 5/12 sessions · 2/4 days · 88% agreed");

		expect(
			standingText(
				entry({
					project: "/code/mono",
					band: "ask-and-go",
					earnedBand: "ask-and-go",
					standing: {
						sessions: 18,
						activeDays: 6,
						agreement: 86,
						cleanStreak: 10,
						brokenInLast5: 0,
						brokenInLast10: 0,
					},
				}),
			),
		).toBe("Toward Assume · 18/35 sessions · 6/10 days · 86% agreed");

		expect(
			standingText(
				entry({
					project: "/code/mono",
					band: "assume",
					earnedBand: "assume",
					standing: {
						sessions: 41,
						activeDays: 12,
						agreement: 93,
						cleanStreak: 15,
						brokenInLast5: 0,
						brokenInLast10: 0,
					},
				}),
			),
		).toBe("Earned · 41 sessions · 12 days · 93% agreed");

		expect(
			standingText(
				entry({
					project: "/code/mono",
					mode: "static",
					band: "ask-and-go",
					pinnedBand: "ask-and-go",
					earnedBand: "ask-and-wait",
					standing: {
						sessions: 10,
						activeDays: 2,
						agreement: 99,
						cleanStreak: 10,
						brokenInLast5: 0,
						brokenInLast10: 0,
					},
					asking: ["defaults", "visual"],
				}),
			),
		).toBe(
			"Earned Ask & wait · 10/12 sessions · 2/4 days · 99% agreed · asks first on Defaults, Visual / UI",
		);

		expect(
			standingText(
				entry({
					project: "/code/mono",
					band: "ask-and-wait",
					earnedBand: "ask-and-wait",
					standing: {
						sessions: 0,
						activeDays: 0,
						agreement: null,
						cleanStreak: 0,
						brokenInLast5: 0,
						brokenInLast10: 0,
					},
				}),
			),
		).toBe("Toward Ask & go · 0/12 sessions · 0/4 days");

		expect(projectName("/code/mono/")).toBe("mono");
		expect(modelName({ project: "", agent: "claude", model: "Opus 4.6" })).toBe(
			"Claude Opus 4.6",
		);
		expect(modelName({ project: "", agent: "codex", model: null })).toBe(
			"Codex",
		);
		expect(bandOf({ band: "assume" }, false)).toBe("ask-and-wait");
	});

	it("groups models by project, nests scope rows, and filters with project radio buttons", async () => {
		serve();
		const page = render(<TrustPage />);
		const mono = await page.findByRole("region", { name: "mono" });
		expect(within(mono).getByText("2 models")).toBeTruthy();
		expect(
			within(mono)
				.getAllByText("Ask & go")
				.filter((el) => el.dataset.slot === "badge"),
		).toHaveLength(2);
		expect(within(mono).getByText("Pinned")).toBeTruthy();
		const opus = within(mono).getByRole("article", { name: "Claude Opus 4.6" });
		expect(within(opus).getByText("splates/")).toBeTruthy();
		expect(within(opus).getByText("Assume")).toBeTruthy();
		expect(
			within(opus).getByText("Earned · 41 sessions · 12 days · 93% agreed"),
		).toBeTruthy();
		expect(page.getByRole("region", { name: "vexml" })).toBeTruthy();

		const vexmlFilter = page.getByRole("radio", { name: "vexml" });
		fireEvent.click(vexmlFilter);
		expect(vexmlFilter.getAttribute("aria-checked")).toBe("true");
		expect(page.queryByRole("region", { name: "mono" })).toBeNull();

		const allFilter = page.getByRole("radio", { name: "All projects" });
		fireEvent.click(allFilter);
		expect(allFilter.getAttribute("aria-checked")).toBe("true");
		expect(page.getByRole("region", { name: "mono" })).toBeTruthy();
	});

	it("stages level overrides behind Apply and cancel, switches back to Auto, and resets history", async () => {
		const { puts } = serve();
		const page = render(<TrustPage />);
		const mono = await page.findByRole("region", { name: "mono" });
		const opus = within(mono).getByRole("article", { name: "Claude Opus 4.6" });
		const trigger = within(opus).getByRole("button", {
			name: "Claude Opus 4.6 trust level",
		});
		expect(trigger.textContent).toContain("Auto");

		const openMenu = async (button: HTMLElement) => {
			await act(async () => {
				fireEvent.click(button);
			});
		};

		// Stage "Assume" and cancel without saving.
		await openMenu(trigger);
		const assumeOption = await waitFor(() =>
			page.getByRole("menuitemradio", { name: "Assume" }),
		);
		fireEvent.click(assumeOption);
		expect(puts).toHaveLength(0);
		expect(within(opus).getByRole("button", { name: "Apply" })).toBeTruthy();
		fireEvent.click(
			within(opus).getByRole("button", { name: "Cancel change" }),
		);
		expect(within(opus).queryByRole("button", { name: "Apply" })).toBeNull();
		expect(trigger.textContent).toContain("Auto");

		// Stage "Assume" and Apply to pin static.
		await openMenu(trigger);
		fireEvent.click(
			await waitFor(() => page.getByRole("menuitemradio", { name: "Assume" })),
		);
		fireEvent.click(within(opus).getByRole("button", { name: "Apply" }));
		await waitFor(() => expect(puts).toHaveLength(1));
		await waitFor(() => expect(within(opus).getByText("Pinned")).toBeTruthy());

		// Switch pinned Codex model back to Auto (earned).
		const codex = within(mono).getByRole("article", { name: "Codex GPT-5.4" });
		const codexTrigger = within(codex).getByRole("button", {
			name: "Codex GPT-5.4 trust level",
		});
		expect(codexTrigger.textContent).toContain("Ask & go");
		await openMenu(codexTrigger);
		fireEvent.click(
			await waitFor(() =>
				page.getByRole("menuitemradio", { name: "Auto (earned)" }),
			),
		);
		fireEvent.click(within(codex).getByRole("button", { name: "Apply" }));
		await waitFor(() => expect(puts).toHaveLength(2));
		await waitFor(() => expect(within(codex).queryByText("Pinned")).toBeNull());

		// Reset history via dropdown item + confirmation.
		await openMenu(trigger);
		fireEvent.click(
			await waitFor(() =>
				page.getByRole("menuitem", { name: "Reset history…" }),
			),
		);
		expect(within(opus).getByText("Forget 18 sessions?")).toBeTruthy();
		fireEvent.click(within(opus).getByRole("button", { name: "Reset" }));
		await waitFor(() => expect(puts).toHaveLength(3));
		await waitFor(() =>
			expect(within(opus).getByText("Ask & wait")).toBeTruthy(),
		);

		expect(puts).toEqual([
			{
				project: "/code/mono",
				agent: "claude",
				model: "Opus 4.6",
				mode: "static",
				band: "assume",
			},
			{
				project: "/code/mono",
				agent: "codex",
				model: "GPT-5.4",
				mode: "dynamic",
			},
			{
				project: "/code/mono",
				agent: "claude",
				model: "Opus 4.6",
				reset: true,
			},
		]);
	});

	it("renders the simplified Overview card on How it works without 0-100 scores", async () => {
		serve();
		const page = render(<TrustPage />);
		await page.findByRole("region", { name: "mono" });
		fireEvent.click(page.getByRole("tab", { name: "How it works" }));
		const overview = page.getByRole("region", { name: "Overview" });
		expect(within(overview).getByText("Ask & wait")).toBeTruthy();
		expect(within(overview).getByText("Start")).toBeTruthy();
		expect(within(overview).getByText("Ask & go")).toBeTruthy();
		expect(within(overview).getByText("Days")).toBeTruthy();
		expect(within(overview).getByText("Assume")).toBeTruthy();
		expect(within(overview).getByText("Weeks")).toBeTruthy();
		expect(within(overview).getByText("Earned over time:")).toBeTruthy();
		expect(
			within(overview).getByText("Steady through exploration:"),
		).toBeTruthy();
		expect(within(overview).getByText("Hard limits always hold:")).toBeTruthy();
		expect(within(overview).queryByText(/\/100|below 70|70 to 89/)).toBeNull();
	});

	it("shows declared scopes with session counts and removes them", async () => {
		serve();
		const page = render(<TrustPage />);
		await page.findByRole("region", { name: "mono" });
		fireEvent.click(page.getByRole("tab", { name: "Scopes" }));
		const monoScopes = page.getAllByRole("region", { name: "mono" }).at(-1);
		if (monoScopes === undefined) {
			throw new Error("Expected mono region in Scopes tab");
		}
		expect(within(monoScopes).getByText("splates/")).toBeTruthy();
		expect(within(monoScopes).getByText("1 model · 41 sessions")).toBeTruthy();
		expect(
			within(monoScopes).getByRole("button", { name: "Remove splates/" }),
		).toBeTruthy();
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

		fireEvent.click(page.getByRole("radio", { name: "vexml" }));
		expect(
			page.queryByRole("article", {
				name: "Write down a rule for: Place export near the score?",
			}),
		).toBeNull();
		const vexmlCard = page.getByRole("article", {
			name: "Write down a rule for: Align dynamics to noteheads?",
		});
		expect(within(vexmlCard).getByText("1 correction · Task #19")).toBeTruthy();

		fireEvent.click(within(vexmlCard).getByRole("button", { name: "Dismiss" }));
		await waitFor(() =>
			expect(
				page.queryByRole("article", {
					name: "Write down a rule for: Align dynamics to noteheads?",
				}),
			).toBeNull(),
		);
		expect(deleted).toEqual(["/api/todos/19?project=vexml"]);

		fireEvent.click(page.getByRole("radio", { name: "All projects" }));
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
	over: Partial<TrustEntry> & Pick<TrustEntry, "project">,
): TrustEntry {
	const band = over.band ?? "ask-and-go";
	const earnedBand = over.earnedBand ?? band;
	const score = band === "assume" ? 95 : band === "ask-and-go" ? 80 : 50;
	return {
		agent: "claude",
		model: null,
		band,
		earnedBand,
		pinnedBand: over.mode === "static" ? band : null,
		standing: {
			sessions: 18,
			activeDays: 6,
			agreement: 86,
			cleanStreak: 10,
			brokenInLast5: 0,
			brokenInLast10: 0,
		},
		asking: [],
		score,
		dynamicScore:
			earnedBand === "assume" ? 95 : earnedBand === "ask-and-go" ? 80 : 50,
		mode: "dynamic",
		staticValue: null,
		resetAt: null,
		counts: { kept: 15, amended: 0, overturned: 3, total: 18 },
		kinds: [],
		lastAt: null,
		...over,
	};
}

/**
 * Answers the page's reads with three models across two projects (plus a
 * declared directory scope), and its changes as the server would.
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
	const scopes: TrustScope[] = [{ project: "/code/mono", path: "splates/" }];
	const entries: TrustEntry[] = [
		entry({ project: "/code/mono", model: "Opus 4.6", band: "ask-and-go" }),
		entry({
			project: "/code/mono",
			model: "Opus 4.6",
			scope: "splates/",
			band: "assume",
			earnedBand: "assume",
			standing: {
				sessions: 41,
				activeDays: 12,
				agreement: 93,
				cleanStreak: 15,
				brokenInLast5: 0,
				brokenInLast10: 0,
			},
		}),
		entry({
			project: "/code/mono",
			agent: "codex",
			model: "GPT-5.4",
			band: "ask-and-go",
			earnedBand: "ask-and-wait",
			pinnedBand: "ask-and-go",
			mode: "static",
			standing: {
				sessions: 10,
				activeDays: 2,
				agreement: 99,
				cleanStreak: 10,
				brokenInLast5: 0,
				brokenInLast10: 0,
			},
		}),
		entry({
			project: "/code/vexml",
			model: "Opus 4.6",
			band: "ask-and-wait",
			standing: {
				sessions: 5,
				activeDays: 2,
				agreement: 88,
				cleanStreak: 5,
				brokenInLast5: 0,
				brokenInLast10: 0,
			},
		}),
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
			return Response.json({ entries, scopes, enabled: true });
		}
		const body = JSON.parse(String(init.body)) as Record<string, unknown>;
		puts.push(body);
		const found = entries.find(
			(each) =>
				each.project === body.project &&
				each.model === body.model &&
				(each.scope ?? undefined) === (body.scope ?? undefined),
		);
		const next = { ...found } as TrustEntry;
		if (body.mode === "static") {
			const band = body.band as TrustBand;
			Object.assign(next, { mode: "static", band, pinnedBand: band });
		} else if (body.mode === "dynamic") {
			Object.assign(next, {
				mode: "dynamic",
				band: next.earnedBand,
			});
		} else if (body.reset === true) {
			Object.assign(next, {
				mode: "dynamic",
				band: "ask-and-wait",
				earnedBand: "ask-and-wait",
				pinnedBand: null,
				standing: {
					sessions: 0,
					activeDays: 0,
					agreement: null,
					cleanStreak: 0,
					brokenInLast5: 0,
					brokenInLast10: 0,
				},
				asking: [],
				resetAt: new Date().toISOString(),
			});
		}
		return Response.json({ entry: next });
	}) as unknown as typeof fetch;
	return { puts, posted, queued, deleted };
}
