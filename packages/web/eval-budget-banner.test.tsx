import { afterEach, describe, expect, it } from "bun:test";
import type { EvalBudgetView } from "@splates/server/evals/browser";
import { EvalBudgetBanner } from "./eval-budget-banner";
import { cleanup, render, waitFor } from "./testing";

describe("EvalBudgetBanner", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		cleanup();
		globalThis.fetch = originalFetch;
	});

	it("renders nothing when the budget was not seeded by an automation", async () => {
		serveBudget({ usd: 10, spent: 2, answers: { "card-1": 10 } });
		const view = render(<EvalBudgetBanner conversation="c-hand" />);
		await waitFor(() =>
			expect(
				view.queryByRole("status", { name: "automation eval budget" }),
			).toBeNull(),
		);
	});

	it("shows the automation name and live spend when seeded by an automation", async () => {
		serveBudget({
			usd: 2,
			spent: 0.4,
			answers: {},
			seeded: { usd: 2, automation: "7", name: "Spend unused quota" },
		});
		const view = render(<EvalBudgetBanner conversation="c-auto" />);
		const banner = await view.findByRole("status", {
			name: "automation eval budget",
		});
		expect(banner.textContent).toContain(
			"$2 eval budget approved by automation Spend unused quota",
		);
		expect(banner.textContent).toContain("$0.40 of $2.00 spent · $1.60 left");
	});

	it("shows the total when the user added budget on top of the automation seed", async () => {
		serveBudget({
			usd: 7,
			spent: 2.5,
			answers: { "card-2": 5 },
			seeded: { usd: 2, automation: "7" },
		});
		const view = render(<EvalBudgetBanner conversation="c-topup" />);
		const banner = await view.findByRole("status", {
			name: "automation eval budget",
		});
		expect(banner.textContent).toContain(
			"$2 eval budget approved by automation #7 · $7 total",
		);
		expect(banner.textContent).toContain("$2.50 of $7.00 spent · $4.50 left");
	});
});

function serveBudget(budget: EvalBudgetView): void {
	globalThis.fetch = (async () =>
		Response.json(budget)) as unknown as typeof fetch;
}
