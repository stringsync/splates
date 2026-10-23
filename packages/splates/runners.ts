import { join } from "node:path";
import { loadConfig } from "@stringsync/splates-server/config";
import { fail } from "@stringsync/splates-server/exit";
import { splatesHome } from "@stringsync/splates-server/models";
import {
	REAPER_FILE,
	type SplatesDeps,
	withRunners,
} from "@stringsync/splates-server/server";
import {
	DIRECT_IDLE,
	type DirectRunner,
	NoRunner,
	parseTimeout,
	runnerServe,
	sizeLabel,
} from "@stringsync/splates-server/workers";
import { cli } from "webappwiz/cmd";
import { type Duration, sleep } from "webappwiz/time";
import { z } from "zod";

/** `splates runners`, which the root cli mounts beside `splates worker`. */
export const splatesRunners = cli<SplatesDeps>("runners").description(
	`the runners \`splates run\` makes for itself in the project's cloud (\`cloud\` in splates.config.ts) when \`splates server\` has none for it: each takes as many commands at once as fit in its CPUs and memory, another is made when none has room, within \`splates budget\`, and each is deleted once idle ${DIRECT_IDLE.mins} minutes`,
);

splatesRunners
	.command("list")
	.description(
		"list them: name, size and price, address, and busy, idle or booting",
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
	.command("reap")
	.description(
		`delete each runner idle ${DIRECT_IDLE.mins} minutes or more, every idle one once the budget's day or month is spent, and any that never booted; with --watch, again every so often for as long as any is up, which \`splates run\` leaves running behind it, one on this machine at a time, so none is left running unused`,
	)
	.option("watch", z.string(), {
		default: "",
		description:
			"how long to wait before each look, as 10m or 90s, looking again for as long as any runner is up",
	})
	.option("idle", z.string(), {
		default: "",
		description: `how long a runner must have stood idle, as 10m or 0s; ${DIRECT_IDLE.mins}m by default`,
	})
	.action(async (opts, ctx) => {
		const idle = opts.idle === "" ? DIRECT_IDLE : lengthOf(opts.idle);
		if (opts.watch === "") {
			const reaped = await opened(ctx, (each) => each.reap(idle));
			ctx.log.info(
				reaped.length === 0
					? "nothing to reap"
					: reaped.map((line) => `deleted ${line}`).join("\n"),
			);
			return;
		}
		if (!(await watching(ctx))) {
			return;
		}
		const every = lengthOf(opts.watch);
		for (;;) {
			await sleep(every);
			const left = await opened(ctx, async (each) => {
				await each.reap(idle);
				return (await each.list()).length;
			});
			if (left === 0) {
				return;
			}
		}
	});

/**
 * Takes the reaper's place on this machine, answering false when another
 * reaper holds it, for this one to leave it that.
 */
async function watching(ctx: SplatesDeps): Promise<boolean> {
	const file = reaperFile(ctx);
	const held = Number((await ctx.fs.read(file).catch(() => "")).trim());
	if (
		Number.isInteger(held) &&
		held > 0 &&
		held !== process.pid &&
		ctx.ps.alive(held)
	) {
		return false;
	}
	await ctx.fs.write(file, String(process.pid));
	return true;
}

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

function lengthOf(text: string): Duration {
	return (
		parseTimeout(text) ??
		fail("usage", `${text} is no length of time: name one as 10m or 90s`, {})
	);
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

function reaperFile(ctx: SplatesDeps): string {
	return join(splatesHome(ctx.ps), REAPER_FILE);
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
