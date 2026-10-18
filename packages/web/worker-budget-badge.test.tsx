import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import type { WorkerBudgetReport } from "@stringsync/splates-server/workers";
import { cleanup, render } from "@testing-library/react";
import { WorkerBudgetBadge } from "./worker-budget-badge";

describe("WorkerBudgetBadge", () => {
	afterEach(cleanup);

	it("says nothing below 80% of every limit", () => {
		const { container } = render(
			<WorkerBudgetBadge budget={report({ day: 3 })} />,
		);

		expect(container.textContent).toBe("");
	});

	it("warns of the limit nearest its end, opening the Budget page", () => {
		const page = render(
			<WorkerBudgetBadge budget={report({ day: 4.6, month: 61 })} />,
		);

		const badge = page.getByRole("link");
		expect(badge.textContent).toBe("Workers: 90% of today's $5.00");
		expect(badge.getAttribute("href")).toBe("#budget");
		expect(badge.className).toContain("amber");
	});

	it("turns red once a limit is reached, saying made workers stopped", () => {
		const page = render(
			<WorkerBudgetBadge
				budget={{
					...report({ month: 75 }),
					stopped: "monthly limit $75.00 reached",
				}}
			/>,
		);

		const badge = page.getByRole("link");
		expect(badge.textContent).toBe("Workers: this month's $75.00 reached");
		expect(badge.className).toContain("destructive");
		expect(badge.getAttribute("title")).toContain("Stopped");
	});

	it("says nothing without a worker provider", () => {
		const { container } = render(<WorkerBudgetBadge budget={null} />);

		expect(container.textContent).toBe("");
	});
});

/** A report with the made workers having spent `spent` of the default limits. */
function report(
	spent: Partial<Record<"hour" | "day" | "month", number>>,
): WorkerBudgetReport {
	const limits = { hour: 0.25, day: 5, month: 75 } as const;
	const windows = { hour: "running now", day: "today", month: "this month" };
	return {
		standing: (["hour", "day", "month"] as const).map((limit) => {
			const used = spent[limit] ?? 0;
			const percent = (used / limits[limit]) * 100;
			return {
				limit,
				window: windows[limit],
				since: 0,
				dollars: limits[limit],
				raised: 0,
				set: false,
				spent: used,
				left: Math.max(0, limits[limit] - used),
				tier:
					percent >= 100 ? 100 : percent >= 90 ? 90 : percent >= 80 ? 80 : 0,
				estimate: true,
			};
		}),
		raises: [],
		rate: 0,
		stopped: null,
		holding: null,
		offer: null,
	};
}
