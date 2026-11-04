import { afterEach, describe, expect, it } from "bun:test";
import type { Cascade } from "@splates/server/ship";
import "./register-dom";
import { ShipRecap } from "./ship-recap";
import { acknowledged } from "./ship-recap-seen";
import { ShipRun } from "./ship-run";
import { cleanup, fireEvent, render, within } from "./testing-library";

describe("ShipRecap", () => {
	afterEach(() => {
		cleanup();
		localStorage.clear();
		location.hash = "";
	});

	it("shows every step, folds a clean project and flags the slow one", () => {
		const view = render(<ShipRecap cascade={shipped()} />);
		expect(view.getByText("Shipped 2 projects in 30m 00s")).toBeTruthy();
		expect(view.getByText(/Slowest: gate of mdom/)).toBeTruthy();
		expect(view.getByText("No errors")).toBeTruthy();
		const mdom = view.getByRole("region", { name: "mdom" });
		expect(within(mdom).getAllByRole("listitem")).toHaveLength(2);
		expect(view.getByLabelText("vexml").tagName).toBe("DETAILS");
		expect(view.getByText("Step 3 of 3")).toBeTruthy();
	});

	it("shows a failed ship recap alongside recovery and failure details", () => {
		const cascade = shipped();
		cascade.status = "stopped";
		for (const step of cascade.steps) {
			step.takes = [];
		}
		const step = cascade.steps[0];
		const stage = step?.stages[1];
		if (step === undefined || stage === undefined) {
			throw new Error("Missing fixture stage");
		}
		step.status = "failed";
		step.note = "Gate failed";
		stage.state = "failed";
		const view = render(
			<ShipRun
				cascade={cascade}
				ship={null}
				onClose={() => {}}
				retry={async () => {}}
				sendToAgent={async () => {}}
			/>,
		);
		expect(view.getByRole("region", { name: "ship recap" })).toBeTruthy();
		expect(view.getByText("Stopped after 30m 00s")).toBeTruthy();
		expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Send to agent" })).toBeTruthy();
		expect(
			view.queryByRole("button", { name: "Plan another ship" }),
		).toBeNull();
	});

	it("reports investigation handoffs without claiming upstream adoption", () => {
		const cascade = shipped();
		cascade.steps = cascade.steps.map((step) => ({
			...step,
			sentToAgent: step.slug === "mdom",
		}));
		const view = render(<ShipRecap cascade={cascade} />);
		expect(view.getByText("Sent to an agent for mdom")).toBeTruthy();
	});

	it("acknowledges the ship and returns to the plan", () => {
		const view = render(<ShipRecap cascade={shipped()} />);
		fireEvent.click(view.getByRole("button", { name: "Plan another ship" }));
		expect(acknowledged()).toBe("c1");
		expect(location.hash).toBe("#ships");
	});
});

function shipped(): Cascade {
	const stage = (
		key: string,
		start: string,
		end: string,
		expected: number,
	) => ({
		key,
		name: key,
		state: "done",
		started: `2026-01-01T${start}Z`,
		ended: `2026-01-01T${end}Z`,
		expected,
		known: true,
		deadline: null,
		check: null,
		log: null,
	});
	return {
		id: "c1",
		from: "mdom",
		status: "done",
		started: "2026-01-01T00:00:00Z",
		ended: "2026-01-01T00:30:00Z",
		steps: [
			{
				slug: "mdom",
				status: "done",
				note: null,
				stages: [
					stage("bump", "00:00:00", "00:05:00", 1_200_000),
					stage("gate", "00:05:00", "00:25:00", 600_000),
				],
			},
			{
				slug: "vexml",
				status: "done",
				note: null,
				stages: [stage("bump", "00:00:00", "00:01:00", 1_200_000)],
			},
		],
	} as unknown as Cascade;
}
