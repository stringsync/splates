import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FORMAT } from "../records";
import type { SplatesDeps } from "./runtime-deps";
import { recordsFirst } from "./update-records";

describe("recordsFirst", () => {
	let fs: FakeFs;
	let ps: FakePs;
	let deps: SplatesDeps;
	let next: SplatesDeps[];
	let asked: { path: string; body: unknown }[];
	let server: ReturnType<typeof Bun.serve>;

	beforeEach(async () => {
		fs = new FakeFs();
		ps = new FakePs();
		ps.setEnv({ SPLATES_HOME: "/home" });
		ps.setCaptureOutput("/repo/.git\n", "");
		deps = { fs, ps, log: new MemoryLogger() } as unknown as SplatesDeps;
		next = [];
		asked = [];
		await fs.mkdir("/repo/.git/splates", { recursive: true });
		await fs.write("/repo/.git/splates/format", "1\n");
		server = Bun.serve({
			port: 0,
			fetch: async (request) => {
				const { pathname } = new URL(request.url);
				asked.push({
					path: pathname,
					body: request.method === "POST" ? await request.json() : null,
				});
				return pathname === "/api/projects"
					? Response.json({
							projects: [
								{ slug: "repo", root: "/repo", gone: false },
								{ slug: "old", root: "/old", gone: true },
							],
						})
					: Response.json({});
			},
		});
	});

	afterEach(() => server.stop(true));

	const run = () =>
		recordsFirst<SplatesDeps>()(deps, async (ctx) => {
			next.push(ctx);
		});

	/** As the child `splates migrate` does, from the second spawn on: git asks first. */
	const migrating = () => {
		let spawns = 0;
		ps.simulate(async () => {
			spawns += 1;
			if (spawns > 1) {
				await fs.write("/repo/.git/splates/format", `${FORMAT}\n`);
			}
			return 0;
		});
	};

	it("leaves records already in this splates's format alone", async () => {
		await fs.write("/repo/.git/splates/format", `${FORMAT}\n`);

		await run();

		expect(next).toHaveLength(1);
		expect(ps.getCalls().some((call) => call.endsWith(" migrate"))).toBe(false);
	});

	it("migrates older records here when no server serves them", async () => {
		migrating();

		await run();

		expect(ps.getCalls().some((call) => call.endsWith(" migrate"))).toBe(true);
		expect(await fs.read("/repo/.git/splates/format")).toBe(`${FORMAT}\n`);
		expect(next).toHaveLength(1);
	});

	it("asks an older server serving them to restart onto this splates, and leaves them for it", async () => {
		await fs.mkdir("/home", { recursive: true });
		await fs.write(
			"/home/server.json",
			JSON.stringify({ url: server.url.origin, pid: ps.pid, release: "0.0.1" }),
		);

		await run();

		expect(asked).toContainEqual({
			path: "/api/checkpoint",
			body: { projects: ["repo"], after: "resume", update: true },
		});
		expect(await fs.read("/repo/.git/splates/format")).toBe("1\n");
		expect(ps.getCalls().some((call) => call.endsWith(" migrate"))).toBe(false);
		expect(next).toEqual([]);
	});

	it("migrates them here past a server no longer running", async () => {
		migrating();
		await fs.mkdir("/home", { recursive: true });
		await fs.write(
			"/home/server.json",
			JSON.stringify({ url: server.url.origin, pid: 4242, release: "0.0.1" }),
		);
		ps.kill(4242);

		await run();

		expect(asked).toEqual([]);
		expect(await fs.read("/repo/.git/splates/format")).toBe(`${FORMAT}\n`);
	});
});
