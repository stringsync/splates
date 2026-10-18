import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, Testing, waitFor, within } from "./testing";
import { workerBudgetFixture } from "./worker-budget-testing";

describe("App's worker budget", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.workerBudget = {
			...workerBudgetFixture({ hour: 0.1, day: 4.2, month: 30 }),
			rate: 0.1,
			projected: 51.4,
			raises: [
				{
					id: 3,
					limit: "day",
					dollars: 2,
					from: 0,
					until: Date.now() + 3_600_000,
				},
			],
			split: {
				day: [
					{
						project: "/home/me/app",
						task: "fix-it",
						dollars: 3,
						slotHours: 2.5,
						estimate: true,
					},
					{
						project: null,
						task: null,
						dollars: 1.2,
						slotHours: 0,
						estimate: true,
					},
				],
				month: [
					{
						project: "/home/me/app",
						task: null,
						dollars: 30,
						slotHours: 40,
						estimate: true,
					},
				],
			},
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const openCard = async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Budget/ })),
		);
		return waitFor(() => view.getByRole("region", { name: "workers budget" }));
	};

	it("shows the burn rate, today, the month and its projection, each an estimate", async () => {
		const card = await openCard();

		const spend = within(card).getByLabelText("spend");
		expect(spend.textContent).toBe(
			"Burn rate$0.10/h est.Today$4.20 est.Month to date$30.00 est.Projected month$51.40 est.",
		);
		expect(
			within(card).getByRole("listitem", { name: "today" }).textContent,
		).toBe("today$4.20 of $5.00");
		expect(card.textContent).toContain("+$2.00 on the day");
	});

	it("splits spend by project and task, today or this month", async () => {
		const card = await openCard();

		const split = () => within(card).getByRole("list", { name: "by task" });
		expect(split().textContent).toContain("app no task");
		await act(async () =>
			fireEvent.click(within(card).getByRole("radio", { name: "Today" })),
		);
		expect(split().textContent).toContain("app fix-it");
		expect(split().textContent).toContain("Idle");
	});

	it("raises a limit at once, before the server answers", async () => {
		const card = await openCard();
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Raise" })),
		);
		fireEvent.change(within(card).getByLabelText("dollars"), {
			target: { value: "3" },
		});
		fireEvent.click(within(card).getByRole("radio", { name: "the month" }));
		testing.reply = testing.workerBudget;

		await act(async () =>
			fireEvent.submit(within(card).getByRole("form", { name: "raise" })),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: expect.stringContaining("/api/worker-budget/raises"),
			method: "POST",
			body: JSON.stringify({ limit: "month", dollars: 3, for: "1d" }),
		});
	});

	it("sets the limits changed in Edit", async () => {
		const card = await openCard();
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Edit" })),
		);
		fireEvent.change(within(card).getByLabelText("day dollars"), {
			target: { value: "8" },
		});
		testing.reply = testing.workerBudget;

		await act(async () =>
			fireEvent.submit(
				within(card).getByRole("form", { name: "edit workers budget" }),
			),
		);

		expect(
			testing.posts
				.filter(({ path }) => path.startsWith("/api/worker-budget"))
				.map(({ path, body }) => [path.split("?")[0], body]),
		).toEqual([["/api/worker-budget/day", JSON.stringify({ dollars: 8 })]]);
	});

	it("shows nothing of workers without a provider", async () => {
		testing.workerBudget = null;
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Budget/ })),
		);
		await waitFor(() => expect(testing.asked).toContain("/api/worker-budget"));

		expect(view.queryByRole("region", { name: "workers budget" })).toBeNull();
	});
});
