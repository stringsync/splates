import { repository } from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import { cli } from "core/cmd";
import { z } from "zod";
import { noteOnRun, retryStep, shipRunsText, shipRunText } from "./ship-runs";

/**
 * `splates ships`: the ship runs this project kept, read from their files,
 * and the retry of a step for the task fixing it.
 */
export const splatesShips = cli<SplatesDeps>("ships")
	.description(
		"read the ship runs the user started, add notes to one, and retry a failed step",
	)
	.fallback("list");

splatesShips
	.command("list")
	.description("list the ship runs kept, newest first")
	.use(repository({ needs: "read" }))
	.action(async (_opts, ctx) => {
		ctx.log.info(await shipRunsText({ storage: ctx.storage }));
	});

splatesShips
	.command("show")
	.description(
		"show a ship run from its file: each target and step, errors and fixes; with --target and --step, everything that step printed on its last try",
	)
	.use(repository({ needs: "read" }))
	.arg("run", z.string(), {
		default: "",
		description: "the run's id; the newest run when left out",
	})
	.option("target", z.string(), {
		default: "",
		description: "the target of the step to print the output of",
	})
	.option("step", z.string(), {
		default: "",
		description: "the step to print the whole output of",
	})
	.action(async (opts, ctx) => {
		ctx.log.info(await shipRunText({ storage: ctx.storage, ...opts }));
	});

splatesShips
	.command("retry")
	.description(
		"carry a ship the user started on: send a failed step round again, from your task's worktree; it runs in the run's own checkout, the commit the ship started on plus the fixes merged for it, not what has landed on the main tree since. It never starts a ship, answers a prompt or stops a run",
	)
	.use(repository({ needs: "read" }))
	.arg("run", z.string(), { description: "the run's id" })
	.option("target", z.string(), { description: "the step's target" })
	.option("step", z.string(), { description: "the failed step" })
	.option("dev", z.string(), {
		default: "",
		description: "the splates server URL",
	})
	.action(async (opts, ctx) => {
		ctx.log.info(await retryStep(ctx, opts));
	});

splatesShips
	.command("note")
	.description(
		"add a note to a ship run, from your task's worktree: what you found or changed, about a step with --target and --step, with a --link to a task or URL; `ships show` lists it",
	)
	.use(repository({ needs: "read" }))
	.arg("run", z.string(), { description: "the run's id" })
	.arg("text", z.string(), { description: "the note" })
	.option("target", z.string(), {
		default: "",
		description: "the target of the step the note is about",
	})
	.option("step", z.string(), {
		default: "",
		description: "the step the note is about",
	})
	.option("link", z.string(), {
		default: "",
		description: "a task (#2851) or URL the note points to",
	})
	.option("dev", z.string(), {
		default: "",
		description: "the splates server URL",
	})
	.action(async (opts, ctx) => {
		ctx.log.info(await noteOnRun(ctx, opts));
	});
