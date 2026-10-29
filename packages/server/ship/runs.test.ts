import { describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { MemoryStorage } from "../storage/testing";
import type { Cascade } from "./cascade";
import { readGraph } from "./graph";
import type { ShipPlan } from "./plan";
import { ShipRuns } from "./runs";
import { servedProjects } from "./testing";

describe("ShipRuns", () => {
	it("plans, freezes and starts only the frozen plan on approval", async () => {
		const { runs, cascade } = await fixture();
		await runs.start(["webappwiz"]);
		await expect(runs.propose()).rejects.toMatchObject({ reason: "usage" });
		await runs.set("webappwiz", { bump: "minor", why: "new api" });
		await runs.note("mdom", "uses the new api");
		const proposed = await runs.propose();
		expect(proposed.run.state).toBe("proposed");
		expect(proposed.card).toContain("## 🔐 Permission: ship plan: webappwiz");
		expect(proposed.card).toContain("0.0.50 → 0.1.0 (minor)");
		expect(proposed.card).toContain("Adopting: uses the new api");
		const id = proposed.plan?.id as string;
		await expect(runs.approve("other")).rejects.toMatchObject({
			reason: "conflict",
		});
		const run = await runs.approve(id);
		expect(run.state).toBe("running");
		expect(cascade.started[0]?.id).toBe(id);
	});

	it("unfreezes on a change and refuses commands out of turn", async () => {
		const { runs, cascade } = await fixture();
		await expect(runs.propose()).rejects.toMatchObject({ reason: "not_found" });
		await runs.start(["webappwiz"]);
		await runs.set("webappwiz", { bump: "patch", why: "fix" });
		const first = (await runs.propose()).plan?.id as string;
		await runs.leaveOut("splates");
		expect((await runs.current())?.state).toBe("planning");
		await expect(runs.approve(first)).rejects.toMatchObject({
			reason: "conflict",
		});
		const second = (await runs.propose()).plan;
		expect(second?.steps.map((step) => step.slug)).not.toContain("splates");
		expect(second?.id).not.toBe(first);
		await runs.approve(second?.id as string);
		await expect(
			runs.set("webappwiz", { bump: "major" }),
		).rejects.toMatchObject({ reason: "conflict" });
		await expect(runs.start(["mdom"])).rejects.toMatchObject({
			reason: "conflict",
		});
		cascade.current = { ...(cascade.current as Cascade), status: "stopped" };
		expect((await runs.current())?.state).toBe("stopped");
	});

	it("refuses to leave out a picked project or one not in the plan", async () => {
		const { runs } = await fixture();
		await runs.start(["webappwiz"]);
		await expect(runs.leaveOut("webappwiz")).rejects.toMatchObject({
			reason: "usage",
		});
		await expect(runs.leaveOut("nothing")).rejects.toMatchObject({
			reason: "usage",
		});
	});
});

async function fixture() {
	const served = await servedProjects();
	const cascade: { current: Cascade | null; started: ShipPlan[] } = {
		current: null,
		started: [],
	};
	const runs = new ShipRuns({
		storage: new MemoryStorage(),
		ids: new CounterIdProvider(),
		graph: () => readGraph(served.fs, served.sources),
		cascades: {
			current: async () => cascade.current,
			startPlan: async (plan) => {
				cascade.started.push(plan);
				cascade.current = {
					id: "c1",
					from: plan.from,
					status: "running",
					started: "now",
					ended: null,
					steps: [],
				};
				return { cascade: cascade.current, started: true };
			},
		},
	});
	return { runs, cascade };
}
