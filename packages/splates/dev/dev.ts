import type { SplatesDeps } from "@stringsync/splates-server/server";
import type { Cli } from "webappwiz/cmd";
import { z } from "zod";
import { evalSkill } from "./eval";
import { fix } from "./fix";
import { premerge } from "./premerge";
import { ship } from "./ship";
import { approveSuite, test } from "./test";

/** Adds `splates dev`, the commands for working on this repository, to `program`. */
export function mountDev(program: Cli<SplatesDeps>): void {
	// Only `checkout.ts`, the entry `bin/splates` runs, calls this, so the
	// published cli never carries these: a release bundles what its `bin` and
	// `exports` entries import, and `index.ts` imports none of this.
	const dev = program
		.group("dev")
		.description("work on the splates repository");

	dev
		.command("approve-suite")
		.description(
			"let an agent's conversation run the whole test suite once outside the merge gate, as Allow on its run-command card does; refused from an agent",
		)
		.arg("conversation", z.string(), {
			description: "the conversation whose agent asked",
		})
		.action(({ conversation }, { log, ps }) =>
			approveSuite({ conversation, log, ps }),
		);

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
		.command("premerge")
		.description(
			"what the merge gate runs: the checks of `dev fix` without writing, then the full suite here, one run at a time on the machine",
		)
		.option("evals", z.boolean(), {
			default: false,
			description: "run only free eval harness tests (no model calls)",
		})
		.option("all", z.boolean(), {
			default: false,
			description: "run the package's and the eval harness's tests together",
		})
		.action((opts, { log, ps }) => premerge({ ...opts, log, ps }));

	dev
		.command("ship")
		.description("release the package, with its skill stamped at its version")
		.action((_opts, { log, fs, ps }) => ship({ log, fs, ps }));

	dev
		.command("test")
		.description(
			"test a small portion while developing: --changed, --since main, file paths or --test-name-pattern; focused runs use one worker by default; the full suite is for the merge gate, which runs it here one at a time",
		)
		.option("evals", z.boolean(), {
			default: false,
			description: "run only free eval harness tests (no model calls)",
		})
		.option("all", z.boolean(), {
			default: false,
			description: "run the package's and the eval harness's tests together",
		})
		.option("changed", z.boolean(), {
			default: false,
			description:
				"run only tests affected by uncommitted changes (bun test --changed)",
		})
		.option("since", z.string(), {
			default: "",
			description:
				"run only tests affected by changes since a git ref, e.g. --since main; implies --changed",
		})
		.option("test-name-pattern", z.string(), {
			default: "",
			description:
				"run only tests whose name matches this regex; combine with file paths or --changed to narrow further",
		})
		.option("workers", z.coerce.number().int().positive().optional(), {
			description:
				"maximum test workers; focused checks default to 1, full runs use their core allocation",
		})
		.option("ci", z.boolean(), {
			default: false,
			description:
				"print only the failing tests and each run's summary, not every passing test",
		})
		.rest("files", z.string(), {
			description: "run only the test files whose path has one of these",
		})
		.action(({ "test-name-pattern": testNamePattern, ...opts }, { log, ps }) =>
			test({ ...opts, testNamePattern, log, ps }),
		);
}
