import { access } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { projectName } from "webappwiz/creds";
import type { Logger } from "webappwiz/log";
import {
	type Declaration,
	declared,
	parseEvalSpend,
} from "./probe-budget-policy";
import { EvalBudgets } from "./probe-budget-store";

/** Match Scry's project identity, user/device scope and config precedence; keep its spending separate. */
export async function projectEvalBudgets(dir: string): Promise<EvalBudgets> {
	let config: Declaration | undefined;
	const home = process.env.HOME ?? "~";
	for (const path of [
		join(dir, "eval.config.ts"),
		join(
			process.env.XDG_CONFIG_HOME ?? join(home, ".config"),
			"eval/config.ts",
		),
	]) {
		try {
			await access(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				continue;
			}
			throw error;
		}
		const value = (await import(path)).default;
		if (
			!value ||
			typeof value !== "object" ||
			Array.isArray(value) ||
			Object.keys(value).some((key) => key !== "budgets")
		) {
			throw new Error(
				`Invalid eval config: ${path}; expected { budgets: ... }`,
			);
		}
		if (value.budgets !== undefined) {
			config = declared(value.budgets, path);
		}
	}
	const project = await projectName(dir);
	const state = process.env.XDG_STATE_HOME ?? join(home, ".local/state");
	return new EvalBudgets(
		join(state, "wiz", project, "eval-budgets.json"),
		config,
	);
}

/** Free local budget controls; reset removes only the override, never spending. */
export async function evalBudgetCli(
	args: string[],
	dir: string,
	log: Logger,
): Promise<void> {
	const { positionals, values } = parseArgs({
		args,
		allowPositionals: true,
		options: { format: { type: "string", default: "text" } },
	});
	if (!["text", "json"].includes(values.format)) {
		throw new Error("--format must be text or json");
	}
	const [command, spend] = positionals;
	if (
		!(
			(command === undefined && positionals.length === 0) ||
			(command === "set" && positionals.length === 2) ||
			(command === "reset" && positionals.length === 1)
		)
	) {
		throw new Error(
			"Use eval budgets [--format json], eval budgets set <tokens/window|nothing>, or eval budgets reset",
		);
	}
	const parsed =
		command === "set" ? parseEvalSpend(spend as string) : undefined;
	const budgets = await projectEvalBudgets(dir);
	if (command === "set" || command === "reset") {
		await budgets.set(parsed);
	}
	const report = await budgets.report();
	if (values.format === "json") {
		log.info(JSON.stringify(report, null, 2));
		return;
	}
	log.info(
		`Eval budget: ${report.spend ?? "undeclared (model execution refused)"}; source: ${report.from ?? "none"}`,
	);
	for (const window of report.windows) {
		log.info(
			`${window.window}: ${window.limit} limit, ${window.consumed} consumed reservations, ${window.reserved} outstanding, ${window.remaining} remaining tokens`,
		);
	}
	log.info(
		`Observed lifetime usage: ${report.observedTokens} known tokens (${report.unknownTokenJobs} unknown jobs), USD ${report.observedUsd} known (${report.unknownCostJobs} unknown jobs).`,
	);
	log.info(
		`${report.reservations.length} retained reservations. Use --format json for reserved ceilings and observed usage per invocation. ${report.costNote}`,
	);
}
