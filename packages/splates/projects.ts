import {
	grantReach,
	listReaches,
} from "@stringsync/splates-server/project-reaches";
import { REACHES } from "@stringsync/splates-server/projects";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/runtime-deps";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates projects`, which the root cli mounts after `splates lane`. */
export const splatesProjects = cli<SplatesDeps>("projects")
	.description(
		"the other splates projects on this machine, and what agents of each may do in the others through splates: `read` their tasks, todos and lanes; add `todos` to their untriaged lane, as every project may until granted otherwise; or hand their `tasks` to agents and orchestrate them. Any repo command runs on another project as `splates --project <slug> <command>`, refused where it needs more than that project granted",
	)
	.fallback("list");

splatesProjects
	.command("list")
	.use(repository({ needs: "read" }))
	.description(
		"print each other project: its slug, its root, what it may do here, and what this one may do there",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => listReaches(ctx, { json: opts.json }));

splatesProjects
	.command("grant")
	.use(repository({ needs: "own" }))
	.description(
		"let agents of another project do as much as `read`, `todos` or `tasks` here, each including those before it; the user's call, so an agent runs it only when the user asks it to",
	)
	.arg("project", z.string(), { description: "the other project's slug" })
	.arg("reach", z.enum(REACHES), {
		description: "read, todos or tasks",
	})
	.action((opts, ctx) => grantReach(ctx, opts.project, opts.reach));
