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

	it.each([
		["localhost:4269", true],
		["127.0.0.1:4269", true],
		["splates.example.com", false],
	])(
		"tells a page on %s whether it is on rec's machine: %p",
		async (host, here) => {
			const ps = new FakePs();
			ps.simulate(async () => 127);
			const response = await new Rec(ps).read(
				new Request("http://x/api/rec", { headers: { host } }),
			);

			expect((await response.json()).here).toBe(here);
		},
	);

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

	it.each([
		["bun /x/rec record --name a --url about:blank", true],
		["bun /x/rec --name a --url about:blank", true],
		["rec --url about:blank", true],
		["bun /mono/rec/packages/rec/index.ts --name a --url about:blank", true],
		["bun /mono/rec/packages/rec/index.ts record --url about:blank", true],
		["bun /x/rec sessions list --json", false],
		["bun /mono/rec/packages/rec/index.ts status", false],
		["/Applications/Rec.app/Contents/MacOS/Rec --flag", false],
	])("finds a recording rec in %s: %p", async (command, found) => {
		const ps = new FakePs();
		ps.setProcesses([{ pid: 7, ppid: 1, pgid: 7, tpgid: 0, command }]);
		const rec = new Rec(ps);

		expect(await rec.interrupt()).toBe(found);
	});

	it("interrupts a rec it did not start by pid, and reports none running", async () => {
		const ps = new FakePs();
		const rec = new Rec(ps);
		expect(await rec.interrupt()).toBe(false);

		ps.setProcesses([
			{
				pid: 900,
				ppid: 1,
				pgid: 900,
				tpgid: 0,
				command: "bun /x/rec record --name a --url about:blank",
			},
			{ pid: 901, ppid: 1, pgid: 901, tpgid: 0, command: "vim record.ts" },
		]);
		expect(await rec.interrupt()).toBe(true);
		expect(ps.getCalls()).toContain("kill -INT 900");
		expect(ps.getCalls()).not.toContain("kill -INT 901");
	});

	it("closes the rec it started", async () => {
		const ps = new FakePs();
		const rec = new Rec(ps);

		rec.open({ name: "a", url: "about:blank", docker: [], tails: [] });
		expect(await rec.interrupt()).toBe(true);
		expect(ps.getChildren()[0]?.signals).toEqual(["SIGINT"]);
	});
});
