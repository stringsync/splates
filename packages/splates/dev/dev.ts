import type { SplatesDeps } from "@stringsync/splates-server/server";
import type { Cli } from "core/cmd";
import { z } from "zod";
import { evalSkill } from "./eval";
import { publish, ship, trust } from "./ship";

/** Adds `splates dev`, the commands for working on this repository, to `program`. */
export function mountDev(program: Cli<SplatesDeps>): void {
	// Only `checkout.ts`, the entry `bin/splates` runs, calls this, so the
	// published cli never carries these: a release bundles what its `bin` and
	// `exports` entries import, and `index.ts` imports none of this.
	const dev = program
		.group("dev")
		.description("work on the splates repository");

	dev
		.command("eval")
		.description(
			"run the splates skill's eval scenarios on real agents, graded by code checks and a judge; `run` uses tokens billed to an API key or counted against a Claude plan, so run it only when asked",
		)
		.rest("args", z.string(), {
			description:
				"list | plan | run | report <batch>, with [--scenario id] [--agent agent:model@effort] [--baseline rev] [--reps n] [--parallel n]",
		})
		.allowUnknownOption()
		.action((opts, { ps }) => evalSkill({ ...opts, ps }));

	dev
		.command("ship")
		.description("release the package, with its skill stamped at its version")
		.option("dry-run", z.boolean(), {
			default: false,
			description: "rehearse the release, publishing and pushing nothing",
		})
		.action((opts, { log, fs, ps }) =>
			ship({ log, fs, ps, dryRun: opts["dry-run"] }),
		);

	dev
		.command("publish")
		.description(
			"build @stringsync/splates, the server folded in, and publish it at this checkout's version: what stringsync/splates's publish workflow runs, from a job npm trusts",
		)
		.action((_opts, { log, fs, ps }) => publish({ log, fs, ps }));

	dev
		.command("trust")
		.description(
			"have npm trust stringsync/splates's publish workflow to publish @stringsync/splates; once, signing in in a browser",
		)
		.action((_opts, { log, ps }) => trust({ log, ps }));
}
