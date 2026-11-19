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

	it("fetches each declared log source picked, with its zone, in the project's root", async () => {
		const ps = new FakePs();
		ps.setCaptureOutput(JSON.stringify({ running: false }), "");
		const rec = new Rec(ps, {
			logSources: {
				find: async () => ({
					root: "/repo",
					rec: {
						logs: [
							{ name: "api", command: "bin/logs api --since {since}" },
							{ name: "db", command: "bin/logs db", zone: "utc" },
							{ name: "web", command: "bin/logs web" },
						],
					},
				}),
			},
		});
		const response = await rec.start(
			new Request("http://x/api/rec/open", {
				method: "POST",
				body: JSON.stringify({
					name: "a",
					url: "about:blank",
					docker: [],
					tails: [],
					logs: ["db", "api"],
				}),
			}),
		);

		expect(response.status).toBe(204);
		const at = ps.getCalls().findIndex((call) => call.startsWith("rec record"));
		expect(ps.getCalls()[at]).toBe(
			"rec record --name a --url about:blank --logs api=bin/logs api --since {since} --logs db@utc=bin/logs db",
		);
		expect(ps.getCallDirs()[at]).toBe("/repo");
	});

	it("refuses a log source the project does not declare, running nothing", async () => {
		const ps = new FakePs();
		ps.setCaptureOutput(JSON.stringify({ running: false }), "");
		const rec = new Rec(ps, {
			logSources: {
				find: async () => ({
					root: "/repo",
					rec: { logs: [{ name: "api", command: "bin/logs api" }] },
				}),
			},
		});
		const response = await rec.start(
			new Request("http://x/api/rec/open", {
				method: "POST",
				body: JSON.stringify({
					name: "a",
					url: "about:blank",
					docker: [],
					tails: [],
					logs: ["rm -rf ~"],
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.text()).toContain("no log source");
		expect(ps.getChildren()).toEqual([]);
	});

	it("offers the declared log sources to the page, or why they cannot be read", async () => {
		const ps = new FakePs();
		ps.simulate(async () => 127);
		const page = new Request("http://x/api/rec", {
			headers: { host: "localhost:4269" },
		});
		const offered = await new Rec(ps, {
			logSources: {
				find: async () => ({
					root: "/repo",
					rec: {
						logs: [{ name: "api", command: "bin/logs api", label: "API" }],
					},
				}),
			},
		}).read(page);
		expect((await offered.json()).logs).toEqual([
			{ name: "api", command: "bin/logs api", label: "API" },
		]);

		const broken = await new Rec(ps, {
			logSources: {
				find: async () => ({
					root: "/repo",
					rec: { logs: [{ name: "API", command: "x" }] },
				}),
			},
		}).read(page);
		expect((await broken.json()).logsError).toContain("lowercase");
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

	it("waits while rec still processes sessions, then kills it only when it goes quiet", async () => {
		const ps = new FakePs();
		ps.setCaptureOutput(
			JSON.stringify({ running: true, processing: ["a"] }),
			"",
		);
		const rec = new Rec(ps, { pollMs: 5, graceMs: 40 });
		rec.open({ name: "a", url: "about:blank", docker: [], tails: [] });
		const child = ps.getChildren()[0] as ReturnType<FakePs["start"]>;
		const signals: string[] = [];
		const die = child.kill.bind(child);
		// rec ignores SIGINT while it finishes; only SIGKILL ends it.
		child.kill = (signal) => {
			signals.push(signal ?? "SIGTERM");
			const ends = { SIGKILL: die } as Record<string, typeof die>;
			ends[signal ?? "SIGTERM"]?.("SIGKILL");
		};
		const stopping = rec.interrupt();
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(signals).toEqual(["SIGINT"]);

		ps.setCaptureOutput(JSON.stringify({ running: true }), "");
		await stopping;
		expect(signals).toEqual(["SIGINT", "SIGKILL"]);
	});

	it("returns without killing when rec exits by itself", async () => {
		const ps = new FakePs();
		ps.setCaptureOutput(
			JSON.stringify({ running: true, processing: ["a"] }),
			"",
		);
		const rec = new Rec(ps, { pollMs: 5, graceMs: 40 });
		rec.open({ name: "a", url: "about:blank", docker: [], tails: [] });
		const child = ps.getChildren()[0];
		const stopping = rec.interrupt();
		await new Promise((resolve) => setTimeout(resolve, 30));
		child?.exit(0);
		await stopping;
		expect(child?.signals).toEqual(["SIGINT"]);
	});
});
