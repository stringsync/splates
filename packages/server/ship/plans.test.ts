import { describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { MemoryStorage } from "../storage/testing";
import { readGraph } from "./graph";
import { planShip } from "./plan";
import { ShipPlans } from "./plans";
import { servedProjects } from "./testing";

describe("ShipPlans", () => {
	it("saves a plan under an id and draws the same one again", async () => {
		const setup = await fixture();
		const plan = await setup.plans.draw("webappwiz", "patch");
		expect(plan.id).toBeDefined();
		expect(await new ShipPlans(setup.opts).draw("webappwiz", "patch")).toEqual(
			plan,
		);
	});

	it("approves the saved plan with the person's release choices", async () => {
		const setup = await fixture();
		const plan = await setup.plans.draw("webappwiz", "patch");
		const approved = await setup.plans.approve("webappwiz", plan.id as string, {
			mdom: "major",
		});
		expect(approved.steps.find((step) => step.slug === "mdom")).toMatchObject({
			bump: "major",
			to: "2.0.0",
		});
		await expect(
			setup.plans.approve("webappwiz", plan.id as string, {
				sound2score: "major",
			}),
		).rejects.toMatchObject({ reason: "usage" });
	});

	it("approves only the dependents the person kept", async () => {
		const setup = await fixture();
		const plan = await setup.plans.draw("webappwiz", "patch", undefined, [
			"splates",
		]);
		expect(plan.skipped).toEqual(["splates"]);
		const approved = await setup.plans.approve("webappwiz", plan.id as string);
		expect(approved.skipped).toEqual(["splates"]);
		expect(approved.steps.map((step) => step.slug)).not.toContain("splates");
		const kept = await setup.plans.draw("webappwiz", "patch");
		expect(kept.id).not.toBe(plan.id);
		expect(kept.skipped).toBeUndefined();
	});

	it("refuses an unknown or superseded plan", async () => {
		const setup = await fixture();
		await expect(
			setup.plans.approve("webappwiz", "missing"),
		).rejects.toMatchObject({ reason: "conflict" });
		const plan = await setup.plans.draw("webappwiz", "patch");
		await setup.plans.draw("webappwiz", "minor");
		await expect(
			setup.plans.approve("webappwiz", plan.id as string),
		).rejects.toMatchObject({ reason: "conflict" });
	});
});

async function fixture() {
	const served = await servedProjects();
	const opts = {
		storage: new MemoryStorage(),
		ids: new CounterIdProvider(),
		plan: async (
			slug: string,
			bump: "patch" | "minor" | "major",
			skip: string[] = [],
		) => planShip(await readGraph(served.fs, served.sources), slug, bump, skip),
	};
	return { plans: new ShipPlans(opts), opts };
}
