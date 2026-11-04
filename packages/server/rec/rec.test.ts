import { describe, expect, it } from "bun:test";
import { FakePs } from "core/system/testing";
import { Rec } from "./rec";

describe("Rec", () => {
	it("is unavailable when the rec command fails", async () => {
		const ps = new FakePs();
		ps.simulate(async () => 127);
		const state = await new Rec(ps).state();

		expect(state.available).toBe(false);
		expect(state.sources).toEqual([]);
	});

	it("starts rec with the name, page, containers and files chosen", () => {
		const ps = new FakePs();
		new Rec(ps).open({
			name: "brave-otter",
			url: "http://localhost:3000",
			docker: ["web-1", "db-1"],
			tails: ["/tmp/dev.log"],
		});

		expect(ps.getCalls()).toEqual([
			"rec record --name brave-otter --url http://localhost:3000 --docker=web-1,db-1 --tail /tmp/dev.log",
		]);
	});
});
