import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { WorkerBudgetBadge } from "./worker-budget-badge";
import { workerBudgetFixture as report } from "./worker-budget-testing";

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
