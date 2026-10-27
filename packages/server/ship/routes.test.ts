import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FsStorage } from "../storage";
import { ShipRoutes } from "./routes";
import { Shipping } from "./run";
import { nth } from "./testing";

describe("ShipRoutes", () => {
	let ps: FakePs;
	let routes: ShipRoutes;

	beforeEach(() => {
		const fs = new FakeFs();
		ps = new FakePs();
		const shipping = new Shipping({
			storage: new FsStorage("/home/projects/1", fs),
			fs,
			ps,
			log: new MemoryLogger(),
			root: "/demo",
			dir: "/home/projects/1",
			command: "wiz dev ship",
			slug: async () => "demo",
		});
		routes = new ShipRoutes(shipping, fs);
	});

	it("says there is no ship before one starts", async () => {
		expect(await (await routes.ship()).json()).toBeNull();
	});

	it("starts a ship and follows its output to its end", async () => {
		const started = await routes.startShip();
		const child = await nth(ps, 0);
		const output = (await routes.shipOutput()).text();
		child.print("shipped 0.0.58\n");
		child.exit(0);

		expect(started.status).toBe(201);
		expect(await output).toBe("shipped 0.0.58\n");
		expect(await (await routes.ship()).json()).toMatchObject({
			status: "done",
		});
	});
});
