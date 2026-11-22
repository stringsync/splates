import { describe, expect, it } from "bun:test";
import { ShipCommands } from "./commands";
import { ShipPlanRoutes } from "./routes";
import { FakeShipPs } from "./testing";

describe("ShipPlanRoutes", () => {
	it("lists the targets", async () => {
		const response = await routes().shipTargets(get(""));
		expect(await response.json()).toEqual({
			targets: [{ command: "bin/net ship", plan: net }],
			errors: [],
		});
	});

	it("answers with the last listing, marked stale, once one was read", async () => {
		const each = routes();
		await each.shipTargets(get(""));
		const again = await each.shipTargets(get(""));
		expect(await again.json()).toEqual({
			targets: [{ command: "bin/net ship", plan: net }],
			errors: [],
			stale: true,
		});
		const fresh = await each.shipTargets(get("?fresh=1"));
		expect((await fresh.json()).stale).toBeUndefined();
	});

	it("counts the unshipped commits", async () => {
		const response = await routes().shipUnshipped();
		expect(await response.json()).toEqual({ net: 3 });
	});

	it("composes a pick", async () => {
		const response = await routes().shipPlan(
			post({ picks: [{ name: "net" }] }),
		);
		expect(response.status).toBe(200);
		expect((await response.json()).waves).toEqual([["net"]]);
	});

	it("answers 400 to a body it cannot read or a pick it cannot compose", async () => {
		expect((await routes().shipPlan(post({ nope: 1 }))).status).toBe(400);
		const unknown = await routes().shipPlan(post({ picks: [{ name: "zz" }] }));
		expect(unknown.status).toBe(400);
		expect(await unknown.json()).toEqual({
			error: 'No ship command serves "zz"',
		});
	});
});

const get = (query: string) => new Request(`http://x/api/ship/targets${query}`);

const net = {
	name: "net",
	dependencies: [],
	steps: [{ id: "deploy", does: "Deploy" }],
};

const routes = () =>
	new ShipPlanRoutes(
		new ShipCommands(
			["bin/net ship"],
			new FakeShipPs({
				"bin/net ship plan": net,
				"bin/net ship plan --target net": net,
				"bin/net ship unshipped": { net: 3 },
			}),
			"/r",
		),
	);

const post = (body: unknown) =>
	new Request("http://x/api/ship/plan", {
		method: "POST",
		body: JSON.stringify(body),
	});
