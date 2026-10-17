import { webappwiz } from "@webappwiz/cli/webappwiz";
import { z } from "zod";
import { evalSkill } from "./eval";
import { fix } from "./fix";
import { ship } from "./ship";
import { test } from "./test";

/**
 * `wiz` is the `webappwiz` cli under a shorter name, so this repo gets `wiz
 * scry` and `wiz skills` without a prefix. The commands for working on this
 * repo itself live under `wiz dev`.
 */
export const wiz = webappwiz("wiz");

const dev = wiz.group("dev").description("work on this repository");

dev
	.command("eval")
	.description(
		"compare versions of the splates skill by running agents on it; uses tokens billed to an API key or counted against a Claude plan, so run it only when asked",
	)
	.rest("args", z.string(), {
		description:
			"[fast|list|report] [--probe id] [--target agent:model] [--parallel n], or explicit e2e [run|report]",
	})
	.allowUnknownOption()
	.action((opts, { ps }) => evalSkill({ ...opts, ps }));

dev
	.command("fix")
	.description("format, check, and typecheck the repository")
	.option("check", z.boolean(), {
		default: false,
		description: "report problems without writing fixes (for CI)",
	})
	.option("code-only", z.boolean(), {
		default: false,
		description: "run Scry code rules without credentials or model calls",
	})
	.action(({ "code-only": codeOnly, ...opts }, { log, ps }) =>
		fix({ ...opts, codeOnly, log, ps }),
	);

dev
	.command("ship")
	.description("release the package, with its skill stamped at its version")
	.action((_opts, { log, fs, ps }) => ship({ log, fs, ps }));

dev
	.command("test")
	.description("run the package's tests; eval harness tests are separate")
	.option("evals", z.boolean(), {
		default: false,
		description: "run only free eval harness tests (no model calls)",
	})
	.option("all", z.boolean(), {
		default: false,
		description: "run the package's and the eval harness's tests together",
	})
	.action((opts, { log, ps }) => test({ ...opts, log, ps }));
