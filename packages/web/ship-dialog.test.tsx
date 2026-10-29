import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
	ShipBump,
	ShipPlan,
	ShipStep,
} from "@stringsync/splates-server/ship";
import { CHANGED } from "@stringsync/splates-server/ship/browser";
import { ApiError } from "./api";
// Base UI reads the DOM as it loads, so a file run alone needs it registered first.
import "./register-dom";
import { ShipApproval } from "./ship-approval";
import { ShipDialog } from "./ship-dialog";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "./testing-library";

afterEach(cleanup);

describe("ShipDialog", () => {
	let started: { project: string; bump: ShipBump }[];
	let closed: boolean;

	beforeEach(() => {
		started = [];
		closed = false;
	});

	const open = (plan: (project: string, bump: ShipBump) => Promise<ShipPlan>) =>
		render(
			<ShipDialog
				approval={
					new ShipApproval("webappwiz", {
						shipPlan: plan,
						startShip: async (project, bump) => {
							started.push({ project, bump });
						},
					})
				}
				onClose={() => {
					closed = true;
				}}
			/>,
		);

	it("shows recovery inputs and approves only the remaining reviewed work", async () => {
		const requests: (string | undefined)[] = [];
		const approvals: unknown[] = [];
		const approval = new ShipApproval(
			"webappwiz",
			{
				shipPlan: async (_project, _bump, _retry, recovery) => {
					requests.push(recovery);
					return {
						...PLAN,
						id: "reviewed",
						recovery: {
							id: "stopped",
							inputs: [
								{
									project: "webappwiz",
									pins: [{ name: "webappwiz", version: "0.0.54" }],
								},
							],
						},
						steps: PLAN.steps.slice(1).map((step) => ({
							...step,
							review: {
								status: "done",
								proposed: step.bump,
								reasons: "Reviewed remaining repairs",
							},
						})),
					};
				},
				startShip: async (_project, _bump, accepted, recovery) => {
					approvals.push({ accepted, recovery });
				},
			},
			"stopped",
		);
		const view = render(
			<ShipDialog
				approval={approval}
				onClose={() => {
					closed = true;
				}}
			/>,
		);
		expect(await view.findByText("webappwiz: webappwiz@0.0.54")).toBeTruthy();
		expect(view.getByText("Recover ship of webappwiz")).toBeTruthy();
		expect(view.queryByRole("group", { name: "Release type" })).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Approve and ship" })),
		);
		expect(requests).toEqual(["stopped"]);
		expect(approvals).toEqual([
			{
				accepted: { id: "reviewed", choices: { mdom: "patch" } },
				recovery: "stopped",
			},
		]);
	});

	it("disables approval when recovery is complete or its registry check fails", async () => {
		const server = new RecoveryServer();
		const approval = new ShipApproval("webappwiz", server, "stopped");
		const view = render(<ShipDialog approval={approval} onClose={() => {}} />);
		expect(await view.findByText("Nothing remains to recover.")).toBeTruthy();
		expect(
			(
				view.getByRole("button", {
					name: "Approve and ship",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		server.offline = true;
		await act(async () => approval.draw());
		expect(approval.plan).toBeNull();
		expect(approval.ready).toBe(false);
		expect(view.getByRole("button", { name: "Retry plan" })).toBeTruthy();
	});

	it("shows each project of the plan in order, and Approve starts the ship", async () => {
		const view = open(async () => PLAN);
		const list = await waitFor(() =>
			view.getByRole("list", { name: "Ship plan" }),
		);
		const rows = within(list).getAllByRole("listitem");
		expect(rows.map((row) => row.textContent)).toEqual([
			expect.stringContaining("The project shipped."),
			expect.stringContaining("Takes webappwiz from webappwiz"),
			expect.stringContaining("Only takes its bump: private."),
		]);
		expect(rows[1]?.textContent).toContain("1.4.2 → 1.4.3");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Approve and ship" })),
		);

		await waitFor(() => expect(closed).toBe(true));
		expect(started).toEqual([{ project: "webappwiz", bump: "patch" }]);
	});

	it("nests each project under its first dependency and names every shared input", async () => {
		const [rootStep, mdomStep, soundStep] = PLAN.steps;
		const view = open(async () => ({
			...PLAN,
			steps: [
				rootStep,
				step({
					slug: "splates",
					takes: [
						{
							project: "webappwiz",
							pins: [{ name: "webappwiz", version: "0.0.53" }],
						},
					],
				}),
				mdomStep,
				step({
					slug: "vexml",
					takes: [
						{
							project: "mdom",
							pins: [{ name: "@stringsync/mdom", version: "1.4.2" }],
						},
					],
				}),
				{
					...soundStep,
					takes: [
						{
							project: "webappwiz",
							pins: [{ name: "webappwiz", version: "0.0.53" }],
						},
						...soundStep.takes,
						{
							project: "vexml",
							pins: [{ name: "vexml", version: "0.9.7" }],
						},
					],
				},
			],
		}));
		const list = await waitFor(() =>
			view.getByRole("list", { name: "Ship plan" }),
		);
		const direct = within(list).getByRole("list", {
			name: "webappwiz dependents",
		});
		expect(
			within(direct).getByRole("listitem", { name: "splates" }),
		).toBeTruthy();
		const mdom = within(direct).getByRole("listitem", { name: "mdom" });
		expect(
			within(mdom).getByRole("list", { name: "mdom dependents" }),
		).toBeTruthy();
		const shared = within(direct).getByRole("listitem", {
			name: "sound2score",
		});
		expect(shared.textContent).toContain("shared dependent");
		expect(shared.textContent).toContain("from webappwiz");
		expect(shared.textContent).toContain("from mdom");
		expect(shared.textContent).toContain("from vexml");
		expect(
			within(list).getAllByRole("listitem", { name: "sound2score" }),
		).toHaveLength(1);
	});

	it("leaves a dependent out and adds it back, redrawing the plan each time", async () => {
		const asked: string[][] = [];
		const view = render(
			<ShipDialog
				approval={
					new ShipApproval("webappwiz", {
						shipPlan: async (_project, _bump, _retry, _recovery, skip = []) => {
							asked.push(skip);
							return skip.includes("mdom")
								? { ...PLAN, steps: PLAN.steps.slice(0, 1), skipped: ["mdom"] }
								: PLAN;
						},
						startShip: async () => {},
					})
				}
				onClose={() => {}}
			/>,
		);
		await waitFor(() => view.getByRole("list", { name: "Ship plan" }));
		expect(
			view.queryByRole("button", { name: "Leave webappwiz out" }),
		).toBeNull();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Leave mdom out" })),
		);
		const left = await view.findByRole("region", { name: "Left out" });
		expect(left.textContent).toContain("mdom");
		expect(
			within(view.getByRole("list", { name: "Ship plan" })).getAllByRole(
				"listitem",
			),
		).toHaveLength(1);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add mdom back" })),
		);
		await waitFor(() =>
			expect(view.queryByRole("region", { name: "Left out" })).toBeNull(),
		);
		expect(asked).toEqual([[], ["mdom"], []]);
	});

	it("redraws at the selected release type and approves that bump", async () => {
		const view = open(async (_, bump) => ({
			...PLAN,
			steps: PLAN.steps.map((step, index) =>
				index === 0
					? { ...step, bump, to: bump === "major" ? "2.0.0" : "1.4.3" }
					: step,
			),
		}));
		await waitFor(() => view.getByRole("list", { name: "Ship plan" }));

		await act(async () =>
			fireEvent.click(
				within(view.getByRole("group", { name: "Release type" })).getByRole(
					"button",
					{ name: "Major" },
				),
			),
		);
		await waitFor(() => {
			const rows = within(
				view.getByRole("list", { name: "Ship plan" }),
			).getAllByRole("listitem");
			expect(rows[0]?.textContent).toContain("1.4.2 → 2.0.0");
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Approve and ship" })),
		);

		await waitFor(() => expect(closed).toBe(true));
		expect(started).toEqual([{ project: "webappwiz", bump: "major" }]);
	});

	it("names the reviewing agent and what it does, and asks before leaving mid-review", async () => {
		const drawn: ShipPlan = structuredClone(PLAN);
		drawn.id = "review-2";
		(drawn.steps[1] as ShipStep).review = {
			status: "pending",
			proposed: null,
			reasons: "Reviewing upstream",
			progress: {
				agent: "sonnet",
				activity: "Running Read: src/index.ts",
				since: new Date().toISOString(),
			},
		};
		let closed = false;
		const approval = new ShipApproval("webappwiz", {
			shipPlan: async () => structuredClone(drawn),
			startShip: async () => {},
		});
		const view = render(
			<ShipDialog approval={approval} onClose={() => (closed = true)} />,
		);
		await waitFor(() => view.getByText(/sonnet · Running Read: src\/index.ts/));
		fireEvent.click(view.getByRole("button", { name: "Cancel" }));
		await waitFor(() => view.getByText("Leave while agents review?"));
		expect(closed).toBe(false);
		fireEvent.click(view.getByRole("button", { name: "Leave anyway" }));
		expect(closed).toBe(true);
	});

	it("blocks approval during review, shows reasons and approves an edited dependent release", async () => {
		let drawn: ShipPlan = structuredClone(PLAN);
		drawn.id = "review-1";
		(drawn.steps[1] as ShipStep).review = {
			status: "pending",
			proposed: null,
			reasons: "Reviewing upstream",
		};
		let approved: unknown;
		const approval = new ShipApproval("webappwiz", {
			shipPlan: async () => structuredClone(drawn),
			startShip: async (_project, _bump, choice) => {
				approved = choice;
			},
		});
		const view = render(<ShipDialog approval={approval} onClose={() => {}} />);
		await waitFor(() => view.getByText(/reviewing dependencies/i));
		const approveButton = view.getByRole("button", {
			name: "Approve and ship",
		});
		expect(approveButton.hasAttribute("disabled")).toBe(true);
		const waiting = view.getByText(
			"Approve and ship is waiting for every dependency review to finish.",
		);
		expect(approveButton.getAttribute("aria-describedby")).toBe(waiting.id);
		expect(await approval.approve()).toBe(false);
		drawn = structuredClone(drawn);
		(drawn.steps[1] as ShipStep).review = {
			status: "failed",
			proposed: null,
			reasons: "The upstream changes could not be reviewed",
		};
		await act(() => approval.draw());
		expect(
			view.getByText(
				"Approve and ship is blocked by a failed dependency review. Retry reviews to continue.",
			),
		).toBeTruthy();
		expect(approveButton.hasAttribute("disabled")).toBe(true);
		drawn = structuredClone(drawn);
		(drawn.steps[1] as ShipStep).review = {
			status: "done",
			proposed: "minor",
			reasons: "New adapter preserves old calls",
		};
		await act(() => approval.draw());
		expect(
			view.getByText("Proposed minor: New adapter preserves old calls"),
		).toBeTruthy();
		expect(
			view.queryByText(
				"Approve and ship is blocked by a failed dependency review. Retry reviews to continue.",
			),
		).toBeNull();
		await act(() =>
			fireEvent.click(
				within(
					view.getByRole("group", { name: "Release type for mdom" }),
				).getByRole("button", { name: "Major" }),
			),
		);
		expect(view.getByText("1.4.2 → 2.0.0")).toBeTruthy();
		await act(() =>
			fireEvent.click(view.getByRole("button", { name: "Approve and ship" })),
		);
		expect(approved).toMatchObject({
			id: "review-1",
			choices: { mdom: "major", webappwiz: "patch" },
		});
	});

	it("gives each changed project its own release type, with none above the plan", async () => {
		const drawn: ShipPlan = {
			from: CHANGED,
			id: "changed-1",
			steps: [
				step({
					slug: "webappwiz",
					from: "0.0.50",
					to: "0.0.51",
					why: "it has 2 unshipped commits since v0.0.50",
				}),
				step({
					slug: "splates",
					from: "0.0.57",
					to: "0.0.58",
					why: "it has 1 unshipped commit since v0.0.57",
				}),
			],
		};
		let approved: unknown;
		const approval = new ShipApproval(CHANGED, {
			shipPlan: async () => structuredClone(drawn),
			startShip: async (_project, _bump, choice) => {
				approved = choice;
			},
		});
		const view = render(<ShipDialog approval={approval} onClose={() => {}} />);
		await waitFor(() =>
			view.getByText("It has 2 unshipped commits since v0.0.50."),
		);
		expect(view.queryByRole("group", { name: "Release type" })).toBeNull();
		await act(() =>
			fireEvent.click(
				within(
					view.getByRole("group", { name: "Release type for splates" }),
				).getByRole("button", { name: "Minor" }),
			),
		);
		expect(view.getByText("0.0.57 → 0.1.0")).toBeTruthy();
		await act(() =>
			fireEvent.click(view.getByRole("button", { name: "Approve and ship" })),
		);
		expect(approved).toMatchObject({
			id: "changed-1",
			choices: { webappwiz: "patch", splates: "minor" },
		});
	});

	it("says why there is no plan, and offers no Approve", async () => {
		const view = open(async () => {
			throw new ApiError("usage", "webappwiz names no `ship` command");
		});

		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toContain(
				"webappwiz names no `ship` command",
			),
		);
		expect(
			(
				view.getByRole("button", {
					name: "Approve and ship",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});
});

const PLAN: ShipPlan & { steps: [ShipStep, ShipStep, ShipStep] } = {
	from: "webappwiz",
	steps: [
		step({ slug: "webappwiz", publishes: ["webappwiz"] }),
		step({
			slug: "mdom",
			publishes: ["@stringsync/mdom"],
			takes: [
				{
					project: "webappwiz",
					pins: [{ name: "webappwiz", version: "0.0.50" }],
				},
			],
			why: "vexml pins it",
		}),
		step({
			slug: "sound2score",
			action: "bump",
			from: "0.1.0",
			to: null,
			takes: [
				{
					project: "mdom",
					pins: [{ name: "@stringsync/mdom", version: "1.4.2" }],
				},
			],
			why: "private",
		}),
	],
};

function step(over: Partial<ShipStep>): ShipStep {
	return {
		slug: "webappwiz",
		action: "ship",
		from: "1.4.2",
		bump: "patch",
		to: "1.4.3",
		publishes: [],
		takes: [],
		why: "the project shipped",
		...over,
	};
}

class RecoveryServer {
	offline = false;
	async shipPlan(): Promise<ShipPlan> {
		if (this.offline) {
			throw new ApiError("conflict", "npm unavailable");
		}
		return {
			from: "webappwiz",
			steps: [],
			recovery: { id: "stopped", inputs: [] },
		};
	}
	async startShip(): Promise<void> {
		throw new Error("must not start");
	}
}
