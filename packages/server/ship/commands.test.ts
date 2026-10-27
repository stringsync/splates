import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakePs } from "webappwiz/system/testing";
import { Exit } from "../exit";
import { ship } from "./commands";
import { servedProjects } from "./testing";

describe("ship", () => {
	it("prints the plan for the project it is run in, in dependency order", async () => {
		const { ctx, log } = await served();

		await ship(ctx, { plan: true });

		const printed = String(log.entries.at(-1)?.message);
		expect(printed).toContain("1.4.2 → 1.4.3");
		const rows = printed.split("\n").slice(1);
		expect(rows.map((row) => row.split(/\s+/)[1])).toEqual([
			"mdom",
			"vexml",
			"sound2score",
		]);
	});

	it("prints the plan as JSON for a named project", async () => {
		const { ctx, log } = await served();

		await ship(ctx, { project: "webappwiz", plan: true, json: true });

		const plan = JSON.parse(String(log.entries.at(-1)?.message));
		expect(plan.from).toBe("webappwiz");
		expect(plan.steps).toHaveLength(5);
	});

	it("refuses an agent, even the plan, pointing it at a ship card", async () => {
		const { ctx, ps } = await served();
		ps.setEnv({ SPLATES_CONVERSATION: "c1" });

		const refused = await ship(ctx, { plan: true }).catch((error) => error);

		expect(refused).toBeInstanceOf(Exit);
		expect((refused as Exit).reason).toBe("not_granted");
		expect((refused as Exit).message).toContain("naming `splates ship`");
	});

	it("starts the ship on the server and prints its output to the end", async () => {
		const { ctx, log } = await served();
		const { calls, fetch } = server({ status: "done", to: "1.4.3" });

		await ship({ ...ctx, fetch }, { dev: "http://localhost:4310" });

		expect(calls).toEqual([
			"POST http://localhost:4310/api/ship?project=mdom",
			"GET http://localhost:4310/api/ship/output?project=mdom",
			"GET http://localhost:4310/api/ship?project=mdom",
		]);
		const printed = log.entries.map((entry) => String(entry.message));
		expect(printed).toContain("https://www.npmjs.com/auth/cli/xyz");
		expect(printed.at(-1)).toBe("shipped mdom 1.4.3");
	});

	it("fails with the end of the output when the ship failed", async () => {
		const { ctx } = await served();
		const { fetch } = server({ status: "failed", error: "npm error 403" });

		const failed = await ship(
			{ ...ctx, fetch },
			{ project: "vexml", dev: "http://localhost:4310" },
		).catch((error) => error);

		expect((failed as Exit).reason).toBe("hook_failed");
		expect((failed as Exit).message).toBe("npm error 403");
	});

	it("refuses an agent a ship before it asks the server", async () => {
		const { ctx, ps } = await served();
		const { calls, fetch } = server({ status: "done" });
		ps.setEnv({ SPLATES_STARTED_BY: "c1" });

		const refused = await ship({ ...ctx, fetch }, {}).catch((error) => error);

		expect((refused as Exit).reason).toBe("not_granted");
		expect(calls).toEqual([]);
	});
});

/**
 * A `splates server` that starts a ship from 1.4.2, prints a 2FA link as
 * its output, and ends it as `ended` says.
 */
function server(ended: Record<string, unknown>) {
	const calls: string[] = [];
	const fetch = async (url: string, init?: RequestInit) => {
		calls.push(`${init?.method ?? "GET"} ${url}`);
		if (url.includes("/output")) {
			return new Response(
				"Authenticate your account at:\nhttps://www.npmjs.com/auth/cli/xyz\n",
			);
		}
		return Response.json(
			init?.method === "POST"
				? { status: "running", from: "1.4.2" }
				: { status: "running", from: "1.4.2", to: null, error: null, ...ended },
		);
	};
	return { calls, fetch };
}

/** A `ship` context over the served projects, run by the person unless told otherwise. */
async function served() {
	const { fs, sources } = await servedProjects();
	const log = new MemoryLogger();
	const ps = new FakePs();
	const ctx = {
		fs,
		ps,
		log,
		git: { root: "/mdom" },
		projects: {
			list: async () =>
				sources.map(({ slug, root }) => ({
					slug,
					root,
					added: "2026-10-27T00:00:00.000Z",
					gone: false,
				})),
		},
		configs: {
			read: async (root: string) => ({
				ship: sources.find((each) => each.root === root)?.ship ?? null,
			}),
		},
	};
	return { ctx, log, ps };
}
