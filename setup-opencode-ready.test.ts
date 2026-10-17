import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { OpenCodeSetup } from "./setup-opencode";
import { OpenCodeFixturePs } from "./setup-opencode-fixture";

class ReadyFixture {
	fs = new FakeFs();
	ps = new OpenCodeFixturePs();
	setup = new OpenCodeSetup({ fs: this.fs, ps: this.ps, home: "/arbor" });
	async save() {
		await this.setup.check();
		const signal = new AbortController().signal;
		await this.setup.models.refresh(signal);
		const state = await this.setup.models.preview(
			{ model: "opencode-go/Main", auxiliary: "opencode-go/Small" },
			signal,
		);
		await this.setup.models.apply(state.preview?.token ?? "", true, signal);
	}
}
describe("OpenCode final configuration readiness", () => {
	it("requires a stored recipe and never treats in-memory saving as readiness", async () => {
		const fixture = new ReadyFixture();
		expect(await fixture.setup.readiness("/project", true)).toMatchObject({
			ready: false,
			selection: null,
		});
		await fixture.save();
		const restarted = new OpenCodeSetup({
			fs: fixture.fs,
			ps: fixture.ps,
			home: "/arbor",
		});
		const count = fixture.ps.metadata.length;
		expect(await restarted.readiness("/actual-project")).toMatchObject({
			ready: false,
			selection: { model: "opencode-go/Main" },
		});
		expect(fixture.ps.metadata).toHaveLength(count);
		expect(await restarted.readiness("/actual-project", true)).toMatchObject({
			ready: true,
			cwd: "/actual-project",
			problem: null,
		});
		expect(
			fixture.ps.metadata
				.slice(-5)
				.every((call) => call.cwd === "/actual-project"),
		).toBe(true);
		expect(new Set(fixture.ps.requests)).toEqual(new Set(["initialize"]));
		expect(await restarted.readiness("/different-project")).toMatchObject({
			ready: false,
		});
	});
	it.each(["installed", "connected"] as const)(
		"refuses a missing %s prerequisite and recovers",
		async (prerequisite) => {
			const fixture = new ReadyFixture();
			await fixture.save();
			fixture.ps[prerequisite] = false;
			expect(await fixture.setup.readiness("/project", true)).toMatchObject({
				ready: false,
				problem: expect.any(String),
			});
			fixture.ps[prerequisite] = true;
			expect((await fixture.setup.readiness("/project", true)).ready).toBe(
				true,
			);
		},
	);
	it.each(["conflict", "unavailable", "offline"] as const)(
		"refuses %s configuration and recovers without inference",
		async (fault) => {
			const fixture = new ReadyFixture();
			await fixture.save();
			fixture.ps[fault] = true;
			const state = await fixture.setup.readiness("/project", true);
			expect(state.ready).toBe(false);
			expect(state.problem).toBeString();
			expect(JSON.stringify(state)).not.toContain("private diagnostic");
			fixture.ps[fault] = false;
			expect((await fixture.setup.readiness("/project", true)).ready).toBe(
				true,
			);
			expect(new Set(fixture.ps.requests)).toEqual(new Set(["initialize"]));
		},
	);
});
