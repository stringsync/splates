import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { z } from "zod";
import { fail } from "../exit";
import { table } from "../table";
import { dollars, WORKER_LIMITS, type WorkerLimit } from "./budget";
import type { WorkerBudgetReport } from "./budget-routes";

/** What `splates budget` is run with. */
export interface BudgetCommandOptions {
	/** The `splates server` to ask; empty for the one this agent runs under. */
	dev: string;
	json: boolean;
	log: Logger;
	ps: Ps;
	send?: typeof fetch;
}

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
	stopped: z.string().nullable(),
	holding: z.string().nullable(),
});

/** `splates budget show`: where the worker budget stands. */
export async function showBudget(opts: BudgetCommandOptions): Promise<void> {
	print(await ask("/api/worker-budget", {}, opts), opts);
}

/** `splates budget set`: sets a limit to `dollars`, like `5`, or with `default` to its default. */
export async function setBudget(
	opts: BudgetCommandOptions & { limit: WorkerLimit; dollars: string },
): Promise<void> {
	print(
		await ask(
			`/api/worker-budget/${opts.limit}`,
			{
				method: "PUT",
				body: JSON.stringify({
					dollars: opts.dollars === "default" ? null : amount(opts.dollars),
				}),
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

async function ask(
	path: string,
	init: RequestInit,
	{ dev, ps, send = fetch }: BudgetCommandOptions,
): Promise<WorkerBudgetReport> {
	const url = dev || ps.env("SPLATES_DEV");
	if (!url) {
		fail(
			"usage",
			"no `splates server` to ask: give its URL with --dev, as in --dev http://localhost:4310",
		);
	}
	let response: Response;
	try {
		// The server refuses a request from any other origin than its own.
		response = await send(new URL(path, url), {
			...init,
			headers: {
				origin: new URL(url).origin,
				"content-type": "application/json",
			},
		});
	} catch (error) {
		fail(
			"not_found",
			`splates server at ${url} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const answer = (await response.json().catch(() => ({}))) as {
		reason?: string;
		message?: string;
	};
	if (!response.ok) {
		fail(
			answer.reason === "not_found" ? "not_found" : "usage",
			answer.message ?? `splates server at ${url} answered ${response.status}`,
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
		"Spent is an estimate, at each worker type's list price.",
	];
	for (const raise of report.raises) {
		lines.push(
			`raise ${raise.id}: +${dollars(raise.dollars)} on ${raise.limit} until ${new Date(raise.until).toLocaleString()}`,
		);
	}
	if (report.stopped !== null) {
		lines.push(
			`Stopped: ${report.stopped}; made workers take nothing new until it is raised.`,
		);
	} else if (report.holding !== null) {
		lines.push(`Queue held: ${report.holding}.`);
	}
	log.info(lines.join("\n"));
}
