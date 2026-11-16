import { join } from "node:path";
import type { SplatesDeps } from "@splates/server/server";
import type { Cli } from "core/cmd";
import { serve } from "core/ship";
import { z } from "zod";
import { splatesShip } from "../ship";
import { evalSkill } from "./eval";
import { placeholderShips } from "./placeholder-ships";
import { ROOT } from "./root";

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
		.description(
			"ship @stringsync/splates to npm: answers splates's plan, done and run, or ships it all at a terminal",
		)
		.rest("args", z.string(), {
			description:
				"[plan | done <step> | run <step>] [--bump patch|minor|major]",
		})
		.allowUnknownOption()
		.action((opts, { ps }) => {
			// The release's commands run from mono's root, one above splates's.
			ps.cd(join(ROOT, ".."));
			return serve(splatesShip, opts.args, { ps });
		});

	dev
		.command("placeholder-ship")
		.description(
			"serve the placeholder ship targets, which send nothing out, for hand testing the Ships page",
		)
		.rest("args", z.string(), {
			description:
				"[plan | done <step> | run <step>] [--target name] [--bump patch|minor|major] [--upstream name=version]",
		})
		.allowUnknownOption()
		.action((opts) => serve(placeholderShips(), opts.args));
}
