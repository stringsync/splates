import { basename } from "node:path";
import type { Logger } from "webappwiz/log";
import { type Fs, NodeFs, type Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import { fail } from "../exit";
import { runnerShares, Spend } from "../spend";
import { FsStorage } from "../storage";
import { table } from "../table";
import {
	DEFAULT_RUNNER_CAP,
	DEFAULT_RUNNER_IDLE,
	WORKER_LIMITS,
	WorkerBudget,
	type WorkerLimit,
} from "./budget";
import { dollars } from "./budget-notice";
import { type WorkerBudgetReport, WorkerBudgetRoutes } from "./budget-routes";
import { parseTimeout } from "./job-timeout";
import { serverOf } from "./server-of";

/** What `splates budget` is run with. */
export interface BudgetCommandOptions {
	/** The `splates server` to ask; empty for the one this agent runs under. */
	dev: string;
	json: boolean;
	log: Logger;
	fs?: Fs;
	ps: Ps;
	send?: typeof fetch;
}

/** `splates budget show`: where the worker budget stands. */
export async function showBudget(opts: BudgetCommandOptions): Promise<void> {
	print(await ask("/api/worker-budget", {}, opts), opts);
}

/**
 * `splates budget set`: sets a limit to `dollars`, like `5`, or `runners` to a
 * count, like `16`, or either with `default` to its default.
 */
export async function setBudget(
	opts: BudgetCommandOptions & {
		limit: WorkerLimit | "runners" | "idle";
		dollars: string;
	},
): Promise<void> {
	const given = opts.dollars === "default" ? null : opts.dollars;
	print(
		await ask(
			`/api/worker-budget/${opts.limit}`,
			{
				method: "PUT",
				body: JSON.stringify(
					opts.limit === "runners"
						? { runners: given === null ? null : count(given) }
						: opts.limit === "idle"
							? { idle: given === null ? null : lengthOf(given) }
							: { dollars: given === null ? null : amount(given) },
				),
			},
			opts,
		),
		opts,
	);
}

/** `splates budget raise`: adds `dollars`, like `2`, to a limit for `for`, like `1d`. */
export async function raiseBudget(
	opts: BudgetCommandOptions & {
		limit: WorkerLimit;
		dollars: string;
		for: string;
	},
): Promise<void> {
	print(
		await ask(
			"/api/worker-budget/raises",
			{
				method: "POST",
				body: JSON.stringify({
					limit: opts.limit,
					dollars: amount(opts.dollars),
					for: opts.for,
				}),
			},
			opts,
		),
		opts,
	);
}

/** `splates budget end`: ends raise `id` now. */
export async function endBudgetRaise(
	opts: BudgetCommandOptions & { id: number },
): Promise<void> {
	print(
		await ask(
			`/api/worker-budget/raises/${opts.id}`,
			{
				method: "DELETE",
			},
			opts,
		),
		opts,
	);
}

/**
 * What `splates server` would answer, answered from the machine's own
 * `worker-budget.json` when no server runs, so a person past the budget can
 * raise it though `splates run` made runners with none.
 */
async function askMachine(
	path: string,
	init: RequestInit,
	opts: BudgetCommandOptions,
): Promise<Response> {
	const machine = FsStorage.ofMachine({
		fs: opts.fs ?? new NodeFs(),
		ps: opts.ps,
		log: opts.log,
	});
	const budget = await WorkerBudget.open(
		machine.document("worker-budget.json"),
	);
	const ledger = new Spend(machine);
	const routes = new WorkerBudgetRoutes(budget, null, (since, until) =>
		ledger
			.lines()
			.then((lines) => runnerShares(lines, Date.now(), [], since, until)),
	);
	const request = new Request(new URL(path, "http://localhost"), {
		...init,
		headers: { "content-type": "application/json" },
	});
	const method = init.method ?? "GET";
	if (method === "PUT") {
		return routes.set(request);
	}
	if (method === "POST") {
		return routes.raise(request);
	}
	if (method === "DELETE") {
		return routes.endRaise(request);
	}
	return routes.show();
}

/** Where the worker budget stands, asked of the running `splates server`. */
export async function fetchWorkerBudget(
	opts: Omit<BudgetCommandOptions, "json">,
): Promise<WorkerBudgetReport> {
	return ask("/api/worker-budget", {}, { ...opts, json: false });
}

/** Sets `limit` on the running `splates server`; null gives it back to its default. */
export async function putWorkerLimit(
	limit: WorkerLimit,
	dollars: number | null,
	opts: Omit<BudgetCommandOptions, "json">,
): Promise<void> {
	await ask(
		`/api/worker-budget/${limit}`,
		{ method: "PUT", body: JSON.stringify({ dollars }) },
		{ ...opts, json: false },
	);
}

/** `text` as dollars, a leading `$` allowed, or fails saying what was expected. */
function amount(text: string): number {
	const value = Number(text.trim().replace(/^\$/, ""));
	if (text.trim() === "" || !(Number.isFinite(value) && value >= 0)) {
		fail("usage", `expected dollars, like 5 or 0.25, got "${text}"`, {
			dollars: text,
		});
	}
	return value;
}

/** `text` as a length of time like `10m`, or fails saying what was expected. */
function lengthOf(text: string): string {
	if (parseTimeout(text) === null) {
		fail("usage", `expected a length of time, like 10m, got "${text}"`, {
			idle: text,
		});
	}
	return text;
}

/** `text` as a number of runners, or fails saying what was expected. */
function count(text: string): number {
	const value = Number(text.trim());
	if (text.trim() === "" || !Number.isInteger(value) || value < 0) {
		fail(
			"usage",
			`expected a whole number of runners, like 16, got "${text}"`,
			{
				runners: text,
			},
		);
	}
	return value;
}

async function ask(
	path: string,
	init: RequestInit,
	opts: BudgetCommandOptions,
): Promise<WorkerBudgetReport> {
	const server = await serverOf(opts);
	let response: Response;
	if (server === null) {
		response = await askMachine(path, init, opts);
	} else {
		const { url, send } = server;
		try {
			// The server refuses a request from any other origin than its own.
			response = await send(new URL(path, url).toString(), {
				...init,
				headers: {
					origin: url,
					"content-type": "application/json",
				},
			});
		} catch (error) {
			// A server named only by a stale SPLATES_DEV is no server: the
			// machine's own budget, which `splates run` counts in, answers.
			if (opts.dev) {
				fail(
					"not_found",
					`splates server at ${url} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			response = await askMachine(path, init, opts);
		}
	}
	const answer = (await response.json().catch(() => ({}))) as {
		reason?: string;
		message?: string;
	};
	if (!response.ok) {
		fail(
			answer.reason === "not_found" ? "not_found" : "usage",
			answer.message ??
				`the budget answered ${response.status}${server === null ? "" : ` from ${server.url}`}`,
		);
	}
	return Report.parse(answer) as WorkerBudgetReport;
}

function print(
	report: WorkerBudgetReport,
	{ json, log }: BudgetCommandOptions,
): void {
	if (json) {
		log.info(JSON.stringify(report, null, "\t"));
		return;
	}
	const lines = [
		table(
			["limit", "window", "spent", "of", "left", "%", "set"],
			report.standing.map((each) => {
				const unit = each.limit === "hour" ? "/h" : "";
				return [
					each.limit,
					each.window,
					`${dollars(each.spent)}${unit}`,
					`${dollars(each.dollars)}${unit}${each.raised > 0 ? ` (+${dollars(each.raised)})` : ""}`,
					`${dollars(each.left)}${unit}`,
					each.dollars > 0
						? String(Math.round((each.spent / each.dollars) * 100))
						: "-",
					each.set ? "set" : "default",
				];
			}),
		),
		`Runners: ${report.runners.up === null ? "?" : report.runners.up} up of ${report.runners.cap} allowed (${report.runners.set ? "set" : "default"}), whoever made them.`,
		`Runners stop themselves ${Duration.secs(report.idle.seconds).human()} after their last job (${report.idle.set ? "set" : "default"}); the next job starts a stopped one.`,
		`Projected this month: ${dollars(report.projected)}, if those running now run to its end.`,
		"Spent is an estimate, at each worker type's list price.",
	];
	if (report.split.month.length > 0) {
		lines.push(
			"",
			"This month by task:",
			table(
				["project", "task", "spent", "slot-hours"],
				report.split.month.map((share) => [
					share.project === null ? "idle" : basename(share.project),
					share.project === null ? "-" : (share.task ?? "no task"),
					dollars(share.dollars),
					share.slotHours.toFixed(1),
				]),
			),
		);
	}
	for (const raise of report.raises) {
		lines.push(
			`raise ${raise.id}: +${dollars(raise.dollars)} on ${raise.limit} until ${new Date(raise.until).toLocaleString()}`,
		);
	}
	if (report.stopped !== null) {
		lines.push(
			`Stopped: ${report.stopped}; made workers take nothing new until it is raised.`,
		);
	}
	log.info(lines.join("\n"));
}

const Share = z.object({
	project: z.string().nullable(),
	task: z.string().nullable(),
	dollars: z.number(),
	slotHours: z.number(),
	estimate: z.boolean(),
});

const Report = z.object({
	standing: z.array(
		z.object({
			limit: z.enum(WORKER_LIMITS),
			window: z.string(),
			dollars: z.number(),
			raised: z.number(),
			set: z.boolean(),
			spent: z.number(),
			left: z.number(),
			tier: z.number(),
			estimate: z.boolean(),
		}),
	),
	raises: z.array(
		z.object({
			id: z.number(),
			limit: z.enum(WORKER_LIMITS),
			dollars: z.number(),
			from: z.number(),
			until: z.number(),
		}),
	),
	rate: z.number(),
	// An older `splates server` sends neither.
	projected: z.number().default(0),
	split: z
		.object({ day: z.array(Share), month: z.array(Share) })
		.default({ day: [], month: [] }),
	stopped: z.string().nullable(),
	reviewed: z.boolean(),
	// An older `splates server` sends none.
	// An older `splates server` sends none.
	idle: z
		.object({ seconds: z.number(), set: z.boolean() })
		.default({ seconds: DEFAULT_RUNNER_IDLE.ms / 1000, set: false }),
	runners: z
		.object({
			cap: z.number(),
			set: z.boolean(),
			up: z.number().nullable(),
			left: z.number(),
			tier: z.number(),
		})
		.default({
			cap: DEFAULT_RUNNER_CAP,
			set: false,
			up: null,
			left: DEFAULT_RUNNER_CAP,
			tier: 0,
		}),
});
