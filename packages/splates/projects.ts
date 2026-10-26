import {
	grantReach,
	listReaches,
	REACHES,
} from "@stringsync/splates-server/projects";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates projects`, which the root cli mounts after `splates lane`. */
export const splatesProjects = cli<SplatesDeps>("projects")
	.description(
		"the other splates projects on this machine, and what agents of each may do in the others through splates: `read` their tasks and lanes; add tasks to their untriaged lane with `queue`, as every project may until granted otherwise; or run their queue, lanes and hooks with `tasks`. Any repo command runs on another project as `splates --project <slug> <command>`, refused where it needs more than that project granted",
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
		"let agents of another project do as much as `read`, `queue` or `tasks` here, each including those before it; the user's call, refused an agent, which asks with a `## 🔐 Permission: grant <this> <reach> to <other>` card instead",
	)
	.arg("project", z.string(), { description: "the other project's slug" })
	.arg("reach", z.enum(REACHES), {
		description: "read, queue or tasks",
	})
	.action((opts, ctx) => grantReach(ctx, opts.project, opts.reach));
