import type { SplatesDeps } from "@stringsync/splates-server/server";
import type { Cli } from "webappwiz/cmd";
import { z } from "zod";
import { evalSkill } from "./eval";
import { fix } from "./fix";
import { PROOFS, prove } from "./prove";
import { ship } from "./ship";
import { test } from "./test";

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
		.command("prove")
		.description(
			"prove splates on Linux end to end with Docker, nothing of yours used: `coordinator` runs the server in a Debian container as the user splates, with this machine as its worker, and drives a task, a restart, an archive and a cred through it; `worker` runs a container as a worker of a server here. Read docker/prove-<which>.sh for what each checks",
		)
		.arg("proof", z.enum(PROOFS), {
			description: "coordinator or worker",
		})
		.rest("args", z.string(), {
			description:
				"handed to the script: a port, and for `worker` --agent <id> --model <model> to hand the task to a roster agent",
		})
		.allowUnknownOption()
		.action(({ proof, args }, { log, ps }) => prove({ proof, args, log, ps }));

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
		.option("linux", z.boolean(), {
			default: false,
			description:
				"run them on Linux, in a Docker container built from the checkout, as the box and the workers run; needs Docker",
		})
		.rest("files", z.string(), {
			description: "run only the test files whose path has one of these",
		})
		.action((opts, { log, ps }) => test({ ...opts, log, ps }));
}
