import { describe, expect, it } from "bun:test";
import { FakePs } from "core/system/testing";
import { ShipLive } from "./live";

const identity = { kind: "version" as const, from: "1.0.0", to: "1.0.1" };
const project = {
	slug: "app",
	root: "/app",
	ship: "ship",
	version: "1.0.0",
	packages: [],
	commandPlan: {
		schema: 1 as const,
		identity,
		resuming: false,
		inputs: [],
		steps: [],
	},
};
describe("ShipLive", () => {
	it("uses command status and keeps every artifact", async () => {
		const ps = new FakePs();
		ps.setCaptureOutput(
			JSON.stringify({
				identity,
				artifacts: [
					{ name: "app", deployed: "1.0.1" },
					{ name: "git", deployed: null },
				],
			}),
			"",
		);
		expect(await new ShipLive(ps).check(project, "1.0.1")).toMatchObject({
			live: false,
			lagging: [{ name: "git", deployed: null }],
		});
		expect(ps.getCalls()).toEqual(["sh -c ship status --json"]);
	});
	it("refuses unsupported commands without npm fallback", async () => {
		const ps = new FakePs();
		expect(
			new ShipLive(ps).read({ ...project, commandPlan: undefined }),
		).rejects.toThrow("core/legacy-ship ShipCommand wrapper");
		expect(ps.getCalls()).toEqual([]);
	});
	it("does not treat unavailable status as live", async () => {
		expect(new ShipLive(new FakePs()).read(project)).rejects.toThrow(
			"status --json unavailable",
		);
	});
});
