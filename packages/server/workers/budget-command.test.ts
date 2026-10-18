import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { NodePs } from "webappwiz/system";
import { WorkerBudget } from "./budget";
import {
	endBudgetRaise,
	raiseBudget,
	setBudget,
	showBudget,
} from "./budget-command";
import { WorkerBudgetRoutes } from "./budget-routes";
import { Scheduler } from "./scheduler";

describe("splates budget", () => {
	let server: Bun.Server<undefined>;
	let url: string;
	let budget: WorkerBudget;

	beforeEach(() => {
		budget = WorkerBudget.memory();
		const routes = new WorkerBudgetRoutes(
			budget,
			new Scheduler({ workers: () => [] }, { now: () => Date.now() }),
		);
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

		expect(said(log)).toContain("$0.25/h");
		expect(said(log)).toContain("$5.00");
		expect(said(log)).toContain("$75.00");
		expect(said(log)).toContain("estimate");
	});

	it("shows this month's spend by project and task", async () => {
		await budget.started("made", "small", 0.1);
		await budget.ran([
			{
				id: "c",
				project: "/home/me/app",
				task: "fix-it",
				worker: "made",
				uncapped: false,
			},
		]);
		// Some time on the worker, so the run has spend to show.
		await Bun.sleep(5);
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
		expect(budget.standing()[1]).toMatchObject({ dollars: 5, set: false });
	});

	it("raises a limit for a while, and ends the raise", async () => {
		const log = new MemoryLogger();
		await raiseBudget({
			...opts(log),
			limit: "hour",
			dollars: "0.1",
			for: "2h",
		});

		expect(budget.standing()[0]).toMatchObject({ dollars: 0.35, raised: 0.1 });
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
});
