import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Budgets, RoleBudget } from "./api";
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
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
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

	it("opens again on the budgets it last read, reading them afresh behind", async () => {
		const view = await openBudget();
		await card(view, "som");
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Queue/ })),
		);
		const asked = testing.asked.filter((path) =>
			path.endsWith("/api/budgets"),
		).length;
		testing.readingBudgets = new Promise(() => {});

		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);

		expect((await card(view, "som")).textContent).toContain("4.2m of 7m");
		expect(view.queryByText("Reading budgets…")).toBeNull();
		expect(
			testing.asked.filter((path) => path.endsWith("/api/budgets")).length,
		).toBe(asked + 1);
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
			body: JSON.stringify({ tokens: "500k", for: "4h", project: false }),
		});
		expect(
			within(som).queryByRole("radiogroup", { name: "raise for" }),
		).toBeNull();
	});

	it("marks a shared budget's windows and raises, a window set here beside its shared one", async () => {
		testing.budgets = setOverShared();
		const view = await openBudget();

		const som = await card(view, "som");
		expect(
			within(som).getByRole("listitem", { name: "today" }).textContent,
		).toBe("today1m of 3m");
		expect(
			within(som).getByRole("listitem", { name: "today, shared" }).textContent,
		).toBe("todayevery project9m of 20m (+5m)");
		expect(
			within(som).getByRole("list", { name: "raises" }).textContent,
		).toContain("+5mevery project");
		expect(som.textContent).toContain(
			"held to the limits every project shares too.",
		);
	});

	it("raises a shared budget for every project, or for this project only", async () => {
		testing.budgets = setOverShared();
		const view = await openBudget();
		const som = await card(view, "som");
		await act(async () =>
			fireEvent.click(within(som).getByRole("button", { name: "Raise" })),
		);
		fireEvent.change(within(som).getByLabelText("tokens"), {
			target: { value: "1m" },
		});
		const reach = within(som).getByRole("radiogroup", { name: "raise for" });
		expect(
			within(reach).getByRole("radio", { checked: true }).textContent,
		).toBe("every project");
		fireEvent.click(within(reach).getByRole("radio", { name: "this project" }));
		testing.reply = setOverShared();

		await act(async () =>
			fireEvent.submit(within(som).getByRole("form", { name: "raise" })),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/budgets/som/raises",
			body: JSON.stringify({ tokens: "1m", for: "1d", project: true }),
		});
	});

	it("pauses a model for the span picked", async () => {
		const view = await openBudget();
		const som = await card(view, "som");
		await act(async () =>
			fireEvent.click(within(som).getByRole("button", { name: "Pause" })),
		);
		fireEvent.click(within(som).getByRole("radio", { name: "3 days" }));
		testing.reply = declared();

		await act(async () =>
			fireEvent.submit(within(som).getByRole("form", { name: "pause" })),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/budgets/som/pause",
			method: "PUT",
			body: JSON.stringify({ for: "3d" }),
		});
	});

	it("shows a paused model's pause, keeping its windows, and resumes it", async () => {
		testing.budgets = declared({
			from: Date.now(),
			until: Date.now() + 5 * 3_600_000,
		});
		const view = await openBudget();
		const paused = await card(view, "som");

		expect(within(paused).getByRole("status").textContent).toContain(
			"Paused: questions for it go unasked.",
		);
		expect(
			within(paused).getByRole("listitem", { name: "today" }),
		).toBeTruthy();

		testing.reply = declared();
		await act(async () =>
			fireEvent.click(within(paused).getByRole("button", { name: "Resume" })),
		);

		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/budgets/som/pause",
			method: "DELETE",
		});
	});

	it("cannot pause a model that spends nothing", async () => {
		const view = await openBudget();
		const llm = await card(view, "llm");

		expect(
			(within(llm).getByRole("button", { name: "Pause" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
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

/**
 * The budgets the project declares: a daily som limit, `paused` when given,
 * and an llm that spends nothing.
 */
function declared(paused: RoleBudget["paused"] = null): Budgets {
	return {
		declared: true,
		roles: [
			{
				role: "som",
				spend: "5m/day",
				from: "scry.config.ts",
				set: false,
				shared: false,
				standing: [
					{
						shared: false,
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
						shared: false,
					},
				],
				paused,
			},
			{
				role: "llm",
				spend: "nothing",
				from: "scry.config.ts",
				set: false,
				shared: false,
				standing: [],
				raises: [],
				paused: null,
			},
		],
	};
}

/**
 * A som set to `3m/day` here over the user's shared `20m/day`, held to
 * both, with a shared raise of 5m; an llm that spends nothing.
 */
function setOverShared(): Budgets {
	const [som, llm] = declared().roles as [RoleBudget, RoleBudget];
	return {
		declared: true,
		roles: [
			{
				...som,
				spend: "3m/day",
				set: true,
				shared: true,
				standing: [
					{
						shared: false,
						window: "today",
						tokens: 3_000_000,
						raised: 0,
						spent: 1_000_000,
						left: 2_000_000,
					},
					{
						shared: true,
						window: "today",
						tokens: 20_000_000,
						raised: 5_000_000,
						spent: 9_000_000,
						left: 11_000_000,
					},
				],
				raises: [
					{
						id: 4,
						tokens: 5_000_000,
						from: Date.now(),
						until: Date.now() + 86_400_000,
						shared: true,
					},
				],
			},
			llm,
		],
	};
}
