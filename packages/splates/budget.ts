import type { SplatesDeps } from "@stringsync/splates-server/server";
import {
	endBudgetRaise,
	raiseBudget,
	setBudget,
	showBudget,
} from "@stringsync/splates-server/workers";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

const DEV = {
	default: "",
	description:
		"the `splates server` to ask, a URL such as http://localhost:4310; by default the one an agent runs under, from SPLATES_DEV",
};

const JSON_OPTION = { default: false, description: "emit JSON" };

const LIMIT = z.enum(["hour", "day", "month"]);

const LIMIT_ARG = {
	description:
		"hour, the rate cap on what made workers running at once cost an hour; day; or month",
};

/** `splates budget`, which the root cli mounts beside `splates worker`. */
export const splatesBudget = cli<SplatesDeps>("budget").description(
	"what the workers a `workerProvider` makes may cost, in dollars: a rate cap per hour on those running at once ($1/h by default), and limits on a day ($15) and a month ($200). Past the rate cap, or once a day's or month's limit is spent, no worker is made and the queue says why; reaching the day's or month's stops made workers, whose agents stop at their checkpoint. Each warns at 80%, 90% and 100% by Web Push and on the page's header. Spend is an estimate at each type's list price. Agents' own API spend is not counted here",
);

splatesBudget
	.command("show")
	.description(
		"show each limit: what made workers spent in its window, of how much, and what is left",
	)
	.option("dev", z.string(), DEV)
	.option("json", z.boolean(), JSON_OPTION)
	.action((opts, ctx) =>
		showBudget({
			dev: opts.dev,
			json: opts.json,
			log: ctx.log,
			fs: ctx.fs,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);

splatesBudget
	.command("set")
	.description(
		"set a limit, in dollars (dollars an hour for hour), then show the budget",
	)
	.arg("limit", LIMIT, LIMIT_ARG)
	.arg("dollars", z.string(), {
		description: "like 5 or 0.25, or `default` to give it back to its default",
	})
	.option("dev", z.string(), DEV)
	.option("json", z.boolean(), JSON_OPTION)
	.action((opts, ctx) =>
		setBudget({
			limit: opts.limit,
			dollars: opts.dollars,
			dev: opts.dev,
			json: opts.json,
			log: ctx.log,
			fs: ctx.fs,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);

splatesBudget
	.command("raise")
	.description(
		"add dollars to a limit for a while, on top of what it is set to, then show the budget",
	)
	.arg("limit", LIMIT, LIMIT_ARG)
	.arg("dollars", z.string(), { description: "how much to add, like 2 or 0.1" })
	.option("for", z.string(), {
		default: "1d",
		description:
			"how long it lasts, in hours, days or weeks, like 24h, 1d or 2w",
	})
	.option("dev", z.string(), DEV)
	.option("json", z.boolean(), JSON_OPTION)
	.action((opts, ctx) =>
		raiseBudget({
			limit: opts.limit,
			dollars: opts.dollars,
			for: opts.for,
			dev: opts.dev,
			json: opts.json,
			log: ctx.log,
			fs: ctx.fs,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);

splatesBudget
	.command("end")
	.description("end a raise now, by the number `show` gives it")
	.arg("id", z.coerce.number().int(), { description: "the raise's number" })
	.option("dev", z.string(), DEV)
	.option("json", z.boolean(), JSON_OPTION)
	.action((opts, ctx) =>
		endBudgetRaise({
			id: opts.id,
			dev: opts.dev,
			json: opts.json,
			log: ctx.log,
			fs: ctx.fs,
			ps: ctx.ps,
			send: ctx.fetch,
		}),
	);
