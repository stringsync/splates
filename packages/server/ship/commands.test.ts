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

	it("refuses an agent, even the plan, pointing it at a permission card", async () => {
		const { ctx, ps } = await served();
		ps.setEnv({ SPLATES_CONVERSATION: "c1" });

		const refused = await ship(ctx, { plan: true }).catch((error) => error);

		expect(refused).toBeInstanceOf(Exit);
		expect((refused as Exit).reason).toBe("not_granted");
		expect((refused as Exit).message).toContain("splates ship --plan");
	});
});

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
