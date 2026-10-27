import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
	ShipBump,
	ShipPlan,
	ShipStep,
} from "@stringsync/splates-server/ship";
import { ApiError } from "./api";
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
			fireEvent.click(view.getByRole("button", { name: "Approve" })),
		);

		await waitFor(() => expect(closed).toBe(true));
		expect(started).toEqual([{ project: "webappwiz", bump: "patch" }]);
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
			fireEvent.click(view.getByRole("button", { name: "Major" })),
		);
		await waitFor(() => {
			const rows = within(
				view.getByRole("list", { name: "Ship plan" }),
			).getAllByRole("listitem");
			expect(rows[0]?.textContent).toContain("1.4.2 → 2.0.0");
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Approve" })),
		);

		await waitFor(() => expect(closed).toBe(true));
		expect(started).toEqual([{ project: "webappwiz", bump: "major" }]);
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
			(view.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
});

const PLAN: ShipPlan = {
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
