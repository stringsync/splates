import { loadConfig } from "@stringsync/splates-server/config";
import { fail } from "@stringsync/splates-server/exit";
import {
	type SplatesDeps,
	withRunners,
} from "@stringsync/splates-server/server";
import {
	DEFAULT_RUNNER_IDLE,
	type DirectRunner,
	NoRunner,
	runnerServe,
	sizeLabel,
} from "@stringsync/splates-server/workers";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates runners`, which the root cli mounts beside `splates worker`. */
export const splatesRunners = cli<SplatesDeps>("runners").description(
	`the runners \`splates run\` makes for itself in the project's cloud (\`cloud\` in splates.config.ts) when \`splates server\` has none for it: each takes as many commands at once as fit in its CPUs and memory, another is made when none has room, within \`splates budget\`, and each stops itself ${DEFAULT_RUNNER_IDLE.mins} minutes after its last job (\`splates budget set idle\`), the next job starting it again`,
);

splatesRunners
	.command("list")
	.description(
		"list them: name, size and price, the address Fly's proxy reaches them at, and busy, idle, or the machine's state",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) => {
		const runners = await opened(ctx, (each) => each.list());
		if (opts.json) {
			ctx.log.info(JSON.stringify(runners));
			return;
		}
		ctx.log.info(
			runners.length === 0
				? "no runner is up"
				: runners.map(runnerLine).join("\n"),
		);
	});

splatesRunners
	.command("delete")
	.description(
		"delete a runner and its disk: a stopped one keeps its clone and cache for the next job, and nothing but this, the budget's kept cap or a release deletes it",
	)
	.arg("name", z.string(), {
		description: "the runner's name, as `splates runners list` prints it",
	})
	.action(async ({ name }, ctx) => {
		const deleted = await opened(ctx, (each) => each.destroy(name));
		ctx.log.info(
			deleted.length === 0
				? `no runner named ${name}`
				: deleted.map((each) => `deleted ${each}`).join("\n"),
		);
	});

async function opened<T>(
	ctx: SplatesDeps,
	use: Parameters<typeof withRunners<T>>[2],
): Promise<T> {
	const { stdout, exitCode } = await ctx.ps.spawnCapture([
		"git",
		"rev-parse",
		"--show-toplevel",
	]);
	if (exitCode !== 0) {
		fail("usage", "run it in a splates project", {});
	}
	const { cloud } = await loadConfig(stdout.trim(), { fs: ctx.fs });
	if (cloud === null) {
		fail(
			"no_runner",
			"this project names no `cloud` in splates.config.ts, so `splates run` makes no runners",
			{},
		);
	}
	try {
		return await withRunners(ctx, cloud, use);
	} catch (error) {
		if (error instanceof NoRunner) {
			fail("no_runner", error.message, {});
		}
		throw error;
	}
}

function runnerLine(runner: DirectRunner): string {
	const size =
		runner.size === null
			? runner.type
			: sizeLabel(
					runner.size,
					...(runner.dollarsPerHour === null ? [] : [runner.dollarsPerHour]),
				);
	return `${runner.id}  ${size}  ${runner.address ?? "no address yet"}  ${runner.state}`;
}

// A container gets its bearer secret from the hosting platform, never a flag.
splatesRunners
	.command("serve")
	.description(
		"serve only job channels at /api/jobs over authenticated WebSockets; for the runner image, with SPLATES_RUNNER_SECRET from its hosting environment",
	)
	.option("port", z.coerce.number().int().min(0).max(65535), {
		default: 8080,
		description: "HTTP port behind the hosting proxy",
	})
	.action(({ port }, { ps }) => runnerServe({ port, ps }));
