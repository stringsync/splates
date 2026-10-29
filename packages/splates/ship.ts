import { fail } from "@stringsync/splates-server/exit";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import {
	ship,
	shipHandoff,
	shipLand,
	shipNext,
	shipRun,
	shipStop,
} from "@stringsync/splates-server/ship";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/**
 * `splates ship`, which the root cli mounts: with a project (or none) it ships
 * it, as it always did; `start` and `plan` drive the ship a conversation plans.
 */
export const splatesShip = cli<SplatesDeps>("ship")
	.description(
		"ship projects: `splates ship [<project>]` as below, or plan a ship as a conversation with `splates ship start <projects>` and `splates ship plan show|set|leave-out|note|propose`, which the server holds as a state machine and refuses out of turn. Only the person's Approve on the plan card starts it",
	)
	.fallback("run");

const dev = z.string();
const devOption = {
	default: "",
	description:
		"the `splates server` to plan the ship on, a URL such as http://localhost:4310; by default the one from SPLATES_DEV, else this machine's on its default port",
};

splatesShip
	.command("run")
	.use(repository({ needs: "read" }))
	.description(
		"the default: ship a project and its cascade: `splates server` runs its `ship` command from splates.config.ts on its machine, under your own npm sign-in, signing in with `npm login --auth-type=web` first when npm knows no one, and shows npm's sign-in and 2FA links on the page for any device; this prints that ship's output until it ends. The server then carries the release through every registered project that depends on it, in dependency order: a bump task queued in each once all it takes from are shipped, and, once that merges, each public one with a `ship` command and dependents of its own ships in turn. A bump that asks you waits for your answer. A removed bump task or a failed ship stops the whole run; what shipped stays published. While a cascade is under way, this prints where it stands instead of starting another, or changes one of its pending publishes with `--bump`. `--plan` prints the cascade and runs nothing. The person's alone to start, refused an agent, which asks with a run-command card",
	)
	.arg("project", z.string(), {
		default: "",
		description: "the registered project's slug; this one by default",
	})
	.option("plan", z.boolean(), {
		default: false,
		description: "print the plan without running anything",
	})
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.option("dev", z.string(), {
		default: "",
		description:
			"the `splates server` to run the ship on, a URL such as http://localhost:4310; by default the one from SPLATES_DEV, else this machine's on its default port",
	})
	.option("bump", z.optional(z.enum(["patch", "minor", "major"])), {
		description:
			"how far to move the starting project's version, patch by default; while its cascade runs, change this pending publish instead",
	})
	.option("abandon", z.boolean(), {
		default: false,
		description:
			"end the cascade under way: what shipped stays published, a running ship is stopped, its open bump tasks are removed, and history files it as abandoned",
	})
	.action((opts, ctx) =>
		ship(ctx, {
			project: opts.project || undefined,
			plan: opts.plan,
			json: opts.json,
			dev: opts.dev,
			bump: opts.bump,
			abandon: opts.abandon,
		}),
	);

splatesShip
	.command("start")
	.use(repository({ needs: "read" }))
	.description(
		"start planning a ship of the projects: the plan comes from the dependency graph, which you shape with `ship plan`. With no projects, plans the recovery of the stopped ship, its published versions fixed",
	)
	.arg("projects", z.array(z.string()), {
		default: [],
		description: "the registered projects' slugs to ship",
	})
	.option("dev", dev, devOption)
	.action((opts, ctx) =>
		shipRun(ctx, { do: "start", projects: opts.projects }, { dev: opts.dev }),
	);

const plan = splatesShip.group("plan");

plan
	.command("show")
	.use(repository({ needs: "read" }))
	.description(
		"the ship's state and the plan as the graph and your changes draw it",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.option("dev", dev, devOption)
	.action((opts, ctx) =>
		shipRun(ctx, { do: "show" }, { dev: opts.dev, json: opts.json }),
	);

plan
	.command("set")
	.use(repository({ needs: "read" }))
	.description(
		"set the release type and reasons of a project that ships. Order and versions come from the graph, never from you",
	)
	.arg("project", z.string(), {
		description: "a project in the plan that ships",
	})
	.option("bump", z.optional(z.enum(["patch", "minor", "major"])), {
		description: "how far its version moves",
	})
	.option("why", z.optional(z.string()), {
		description: "why this release type, for the person to read",
	})
	.option("dev", dev, devOption)
	.action((opts, ctx) =>
		shipRun(
			ctx,
			{ do: "set", project: opts.project, bump: opts.bump, why: opts.why },
			{ dev: opts.dev },
		),
	);

plan
	.command("leave-out")
	.use(repository({ needs: "read" }))
	.description(
		"leave a dependent out of the plan, with whatever only it carries the release to",
	)
	.arg("project", z.string(), { description: "the dependent to leave out" })
	.option("dev", dev, devOption)
	.action((opts, ctx) =>
		shipRun(ctx, { do: "leave-out", project: opts.project }, { dev: opts.dev }),
	);

plan
	.command("note")
	.use(repository({ needs: "read" }))
	.description("note what adopting the upstream releases needs in a project")
	.arg("project", z.string(), { description: "a project in the plan" })
	.arg("note", z.string(), { description: "the adoption work" })
	.option("dev", dev, devOption)
	.action((opts, ctx) =>
		shipRun(
			ctx,
			{ do: "note", project: opts.project, note: opts.note },
			{ dev: opts.dev },
		),
	);

plan
	.command("propose")
	.use(repository({ needs: "read" }))
	.description(
		"validate and freeze the plan, and print the `## 🔐 Permission: ship plan` card to post; any later change unfreezes it. The person's Approve on the card starts the ship: no command does",
	)
	.option("dev", dev, devOption)
	.action((opts, ctx) => shipRun(ctx, { do: "propose" }, { dev: opts.dev }));

splatesShip
	.command("next")
	.use(repository({ needs: "read" }))
	.description(
		"the ship agent's loop: waits until the run needs you and prints exactly what to do. A dependent to adopt is opened for you, in a task of its own project: the new versions moved into every package.json, bun install and the upstream's afterBump run, the result committed. Then repair what breaks and `splates ship land <project>`. Run it again after each step, until it says the ship has ended",
	)
	.option("dev", dev, devOption)
	.action((opts, ctx) => shipNext(ctx, { dev: opts.dev }));

splatesShip
	.command("land")
	.use(repository({ needs: "read" }))
	.description(
		"land the task the run opened in a project through that project's own merge gate, after which the server publishes it with the project's `ship` command. Only the project `ship next` named, for the length of the run. A failed gate stops the run and returns it to planning from what it published; `--stop` stops it at a project you cannot land",
	)
	.arg("project", z.string(), { description: "the project `ship next` named" })
	.option("message", z.string(), {
		default: "",
		description: "the commit message the task squashes to",
	})
	.option("stop", z.boolean(), {
		default: false,
		description:
			"stop the run at this project instead of landing it, for a break you cannot fix or a public API change outside the approved plan; give --why",
	})
	.option("why", z.string(), {
		default: "",
		description: "with --stop, what a revised plan must resolve",
	})
	.option("dev", dev, devOption)
	.action((opts, ctx) => {
		if (opts.stop) {
			if (opts.why.trim() === "") {
				fail("usage", "--stop needs --why: what a revised plan must resolve");
			}
			return shipStop(ctx, opts.project, opts.why, { dev: opts.dev });
		}
		return shipLand(ctx, opts.project, {
			message: opts.message,
			dev: opts.dev,
		});
	});

splatesShip
	.command("handoff")
	.use(repository({ needs: "read" }))
	.description(
		"pause the run and add a task that resumes it with `splates ship next`, for when your context runs short: ask the person to queue it with a queue card. Otherwise do the work in one go",
	)
	.option("dev", dev, devOption)
	.action((opts, ctx) => shipHandoff(ctx, { dev: opts.dev }));
