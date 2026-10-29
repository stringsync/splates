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

	it("prepares a review and links to approval without starting a publish", async () => {
		const { ctx, log } = await served();
		const { calls, fetch } = server({ status: "done" });
		await ship({ ...ctx, fetch }, { dev: "http://localhost:4310" });
		expect(calls).toEqual([
			"GET http://localhost:4310/api/ship/cascade?project=mdom",
			"GET http://localhost:4310/api/ship/plan?project=mdom",
		]);
		expect(
			log.entries.map((entry) => String(entry.message)).join("\n"),
		).toContain("http://localhost:4310/?ship=mdom#ships");
	});

	it("prints the cascade under way rather than starting another", async () => {
		const { ctx, log } = await served();
		const { calls, fetch } = server({ status: "done" }, true);

		await ship({ ...ctx, fetch }, { dev: "http://localhost:4310" });

		expect(calls).toEqual([
			"GET http://localhost:4310/api/ship/cascade?project=mdom",
		]);
		const printed = String(log.entries.at(-1)?.message);
		expect(printed).toContain("vexml");
		expect(printed).toContain("waiting");
	});

	it("refuses changing an approved release type during a run", async () => {
		const { ctx } = await served();
		const { calls, fetch } = server({}, true);
		await expect(
			ship(
				{ ...ctx, fetch },
				{ project: "vexml", bump: "major", dev: "http://localhost:4310" },
			),
		).rejects.toMatchObject({ reason: "conflict" });
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("GET");
	});

	it("abandons the cascade under way", async () => {
		const { ctx, log } = await served();
		const { calls, fetch } = server({});

		await ship(
			{ ...ctx, fetch },
			{ abandon: true, project: undefined, dev: "http://localhost:4310" },
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain(
			"POST http://localhost:4310/api/ship/cascade/abandon",
		);
		expect(String(log.entries.at(-2)?.message)).toContain("abandoned");
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

/** The cascade of mdom's ship, as the server answers with it. */
const cascade = {
	from: "mdom",
	status: "running",
	steps: [
		{
			slug: "mdom",
			action: "ship",
			from: "1.4.2",
			status: "shipping",
			task: null,
			note: null,
		},
		{
			slug: "vexml",
			action: "ship",
			from: "2.0.9",
			status: "waiting",
			task: null,
			note: null,
		},
	],
};

/**
 * A `splates server` that starts a ship from 1.4.2, or answers with the
 * cascade under way, prints a 2FA link as
 * its output, and ends it as `ended` says.
 */
function server(ended: Record<string, unknown>, underWay = false) {
	const calls: string[] = [];
	const fetch = async (url: string, init?: RequestInit) => {
		calls.push(`${init?.method ?? "GET"} ${url}`);
		if (url.includes("/cascade?")) {
			return Response.json(underWay ? { ...cascade, status: "running" } : null);
		}
		if (url.includes("/plan?")) {
			return Response.json({ from: "mdom", steps: [] });
		}
		if (url.includes("/output")) {
			return new Response(
				"Authenticate your account at:\nhttps://www.npmjs.com/auth/cli/xyz\n",
			);
		}
		return init?.method === "POST" ||
			init?.method === "PATCH" ||
			init?.method === "DELETE"
			? Response.json(cascade, { status: underWay ? 200 : 201 })
			: Response.json({
					status: "running",
					from: "1.4.2",
					to: null,
					error: null,
					...ended,
				});
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
