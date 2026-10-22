import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { WorkerBudget } from "./budget";
import {
	endBudgetRaise,
	raiseBudget,
	setBudget,
	showBudget,
} from "./budget-command";
import { WorkerBudgetRoutes } from "./budget-routes";

describe("splates budget", () => {
	let server: Bun.Server<undefined>;
	let url: string;
	let budget: WorkerBudget;

	beforeEach(() => {
		budget = WorkerBudget.memory();
		const routes = new WorkerBudgetRoutes(budget, null, async () => [
			{
				project: "/home/me/app",
				task: "fix-it",
				dollars: 0.5,
				slotHours: 1,
				estimate: true,
			},
		]);
		server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			routes: {
				"/api/worker-budget": routes.show,
				"/api/worker-budget/raises": { POST: routes.raise },
				"/api/worker-budget/raises/:id": { DELETE: routes.endRaise },
				"/api/worker-budget/:limit": { PUT: routes.set },
			},
			fetch: () => new Response("not found", { status: 404 }),
		});
		url = `http://127.0.0.1:${server.port}`;
	});

	afterEach(() => {
		server.stop(true);
	});

	function opts(log: MemoryLogger) {
		return { dev: url, json: false, log, ps: new NodePs() };
	}

	function said(log: MemoryLogger): string {
		return log.entries.map((entry) => entry.message).join("\n");
	}

	it("shows each limit in dollars, marked an estimate", async () => {
		const log = new MemoryLogger();

		await showBudget(opts(log));

		expect(said(log)).toContain("$1.00/h");
		expect(said(log)).toContain("$15.00");
		expect(said(log)).toContain("$200.00");
		expect(said(log)).toContain("estimate");
	});

	it("shows this month's spend by project and task", async () => {
		const log = new MemoryLogger();

		await showBudget(opts(log));

		expect(said(log)).toContain("This month by task:");
		expect(said(log)).toMatch(/app\s+fix-it/);
	});

	it("sets a limit, and gives it back to its default", async () => {
		await setBudget({
			...opts(new MemoryLogger()),
			limit: "day",
			dollars: "$2",
		});
		expect(budget.standing()[1]).toMatchObject({ dollars: 2, set: true });

		await setBudget({
			...opts(new MemoryLogger()),
			limit: "day",
			dollars: "default",
		});
		expect(budget.standing()[1]).toMatchObject({ dollars: 15, set: false });
	});

	it("raises a limit for a while, and ends the raise", async () => {
		const log = new MemoryLogger();
		await raiseBudget({
			...opts(log),
			limit: "hour",
			dollars: "0.1",
			for: "2h",
		});

		expect(budget.standing()[0]).toMatchObject({ dollars: 1.1, raised: 0.1 });
		expect(said(log)).toContain("raise 1: +$0.10 on hour");
		await endBudgetRaise({ ...opts(new MemoryLogger()), id: 1 });
		expect(budget.raises).toEqual([]);
	});

	it("refuses what is not dollars", async () => {
		await expect(
			setBudget({ ...opts(new MemoryLogger()), limit: "day", dollars: "lots" }),
		).rejects.toThrow("expected dollars");
	});

	it("refuses a span it cannot read", async () => {
		await expect(
			raiseBudget({
				...opts(new MemoryLogger()),
				limit: "day",
				dollars: "1",
				for: "soon",
			}),
		).rejects.toThrow("hours, days or weeks");
	});

	describe("with no server", () => {
		async function offline(env: Record<string, string> = {}) {
			const home = await mkdtemp(`${tmpdir()}/splates-budget-`);
			const ps = new FakePs();
			ps.setEnv({ HOME: home, SPLATES_HOME: home, ...env });
			return { home, ps };
		}

		it("sets and raises the machine's own budget, which a server reads later", async () => {
			const { home, ps } = await offline();
			const log = new MemoryLogger();
			const base = { dev: "", json: false, ps, fs: new NodeFs() };

			await setBudget({ ...base, log, limit: "day", dollars: "2" });
			await raiseBudget({
				...base,
				log,
				limit: "day",
				dollars: "1",
				for: "1d",
			});

			const kept = JSON.parse(
				await readFile(`${home}/worker-budget.json`, "utf8"),
			);
			expect(kept.limits.day).toBe(2);
			expect(kept.raises).toHaveLength(1);
			expect(said(log)).toContain("raise 1: +$1.00 on day");

			await endBudgetRaise({ ...base, log, id: 1 });
			await showBudget({ ...base, log });
			expect(said(log)).toContain("$2.00");
		});

		it("falls back from a SPLATES_DEV nothing answers, but not from a --dev", async () => {
			const { ps } = await offline({ SPLATES_DEV: "http://localhost:1" });
			const down = (() =>
				Promise.reject(
					new Error("connection refused"),
				)) as unknown as typeof fetch;
			const log = new MemoryLogger();

			await showBudget({
				dev: "",
				json: false,
				log,
				ps,
				send: down,
				fs: new NodeFs(),
			});
			expect(said(log)).toContain("$15.00");

			await expect(
				showBudget({
					dev: "http://localhost:1",
					json: false,
					log,
					ps,
					send: down,
				}),
			).rejects.toThrow("could not be reached");
		});
	});
});
