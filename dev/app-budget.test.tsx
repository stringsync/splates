import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Budgets } from "./api";
import { act, cleanup, fireEvent, Testing, waitFor, within } from "./testing";

describe("App's budget", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.budgets = declared();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const openBudget = async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Budget/ })),
		);
		return view;
	};

	const card = (view: Awaited<ReturnType<typeof openBudget>>, role: string) =>
		waitFor(() => view.getByRole("listitem", { name: `${role} budget` }));

	it("shows each model's spend, what each window has used, and its raises", async () => {
		const view = await openBudget();

		const som = await card(view, "som");
		expect(
			within(som).getByRole("listitem", { name: "today" }).textContent,
		).toBe("today4.2m of 7m (+2m)");
		expect(
			within(som).getByRole("button", { name: "end raise 1" }),
		).toBeTruthy();
		expect(som.textContent).toContain("From scry.config.ts.");
		expect((await card(view, "llm")).textContent).toContain(
			"Asks nothing: questions for it go unasked.",
		);
	});

	it("sets a model's spend from Edit", async () => {
		const view = await openBudget();
		const llm = await card(view, "llm");
		await act(async () =>
			fireEvent.click(within(llm).getByRole("button", { name: "Edit" })),
		);
		fireEvent.change(within(llm).getByLabelText("spend"), {
			target: { value: "1m/month" },
		});
		testing.reply = declared();

		await act(async () =>
			fireEvent.click(within(llm).getByRole("button", { name: "Save" })),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/budgets/llm",
			method: "PUT",
			body: JSON.stringify({ spend: "1m/month" }),
		});
	});

	it("raises a model for the span picked", async () => {
		const view = await openBudget();
		const som = await card(view, "som");
		await act(async () =>
			fireEvent.click(within(som).getByRole("button", { name: "Raise" })),
		);
		fireEvent.change(within(som).getByLabelText("tokens"), {
			target: { value: "500k" },
		});
		fireEvent.click(within(som).getByRole("radio", { name: "4 hours" }));
		testing.reply = declared();

		await act(async () =>
			fireEvent.submit(within(som).getByRole("form", { name: "raise" })),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/budgets/som/raises",
			method: "POST",
			body: JSON.stringify({ tokens: "500k", for: "4h" }),
		});
	});

	it("shows a refusal under the form, keeping it open", async () => {
		const view = await openBudget();
		const llm = await card(view, "llm");
		await act(async () =>
			fireEvent.click(within(llm).getByRole("button", { name: "Edit" })),
		);
		fireEvent.change(within(llm).getByLabelText("spend"), {
			target: { value: "5m" },
		});
		testing.refuseWrites = {
			reason: "usage",
			message: "expected limits like 5m/day",
		};

		await act(async () =>
			fireEvent.click(within(llm).getByRole("button", { name: "Save" })),
		);

		expect(within(llm).getByRole("alert").textContent).toBe(
			"expected limits like 5m/day",
		);
		expect(
			within(llm).getByRole("form", { name: "edit llm budget" }),
		).toBeTruthy();
	});

	it("shows each plan's limits, and says when an agent has not said", async () => {
		testing.talk = {
			agents: [
				{
					id: "claude",
					name: "Claude",
					settings: [],
					limits: [
						{
							window: "seven_day",
							used: 0.5,
							resets: new Date(Date.now() + 86_400_000).toISOString(),
							at: new Date().toISOString(),
						},
					],
				},
				{ id: "codex", name: "Codex", settings: [], limits: [] },
			],
			conversations: [],
		};
		const view = await openBudget();

		const claude = await waitFor(() =>
			view.getByRole("region", { name: "Claude plan limits" }),
		);
		expect(
			within(claude).getByRole("listitem", { name: "Weekly" }),
		).toBeTruthy();
		expect(
			view.getByRole("listitem", { name: "Codex plan" }).textContent,
		).toContain("Not said yet");
	});
});

/** The budgets the project declares: a daily som limit, an llm that spends nothing. */
function declared(): Budgets {
	return {
		declared: true,
		roles: [
			{
				role: "som",
				spend: "5m/day",
				from: "scry.config.ts",
				set: false,
				standing: [
					{
						window: "today",
						tokens: 7_000_000,
						raised: 2_000_000,
						spent: 4_200_000,
						left: 2_800_000,
					},
				],
				raises: [
					{
						id: 1,
						tokens: 2_000_000,
						from: Date.now(),
						until: Date.now() + 86_400_000,
					},
				],
			},
			{
				role: "llm",
				spend: "nothing",
				from: "scry.config.ts",
				set: false,
				standing: [],
				raises: [],
			},
		],
	};
}
