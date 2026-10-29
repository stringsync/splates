import type { Deps } from "webappwiz/cmd";
import type { Fs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import type { SecretStores } from "../creds";
import { fail } from "../exit";
import { merge } from "../merge";
import { openRepository, type Repository } from "../records";
import { add } from "../tasks";
import type { AgentNeed } from "./cascade";
import type { ShipContext } from "./commands";
import { movePins } from "./graph";
import { askServer, serverUrl } from "./run-commands";

/** What `splates ship next`, `land` and `handoff` work with: a command's context. */
export type AdoptContext = Deps &
	Pick<ShipContext, "fetch"> & { fs: Fs; secrets?: SecretStores };

/** How long one `ship next` waits for the run to need the agent before it says so. */
const WAITS = Duration.mins(9);

/** How long one request to the server waits, which answers sooner when the run needs the agent. */
const POLL = Duration.secs(25);

/**
 * `splates ship next`: waits until the run needs the agent and prints exactly
 * what to do. A project to adopt is opened here: its task started in its own
 * tree, the upstream versions moved into every `package.json`, `bun install`
 * and the upstream's `afterBump` run, and the result committed, so the agent
 * only repairs what breaks and lands it.
 */
export async function shipNext(
	ctx: AdoptContext,
	{ dev = "" }: { dev?: string } = {},
): Promise<void> {
	const url = serverUrl(ctx, dev);
	const deadline = Date.now() + WAITS.ms;
	for (;;) {
		const need = (await (
			await askServer(
				ctx,
				["GET", `/api/ship/run/next?wait=${POLL.ms}`, undefined],
				url,
			)
		).json()) as AgentNeed;
		switch (need.kind) {
			case "ended":
				ctx.log.info(
					`The ship is ${need.status}. Nothing is left to do${need.status === "stopped" ? ": `splates ship start` with no projects plans its recovery for the person to approve" : ""}.`,
				);
				return;
			case "land":
				ctx.log.info(landing(need));
				return;
			case "adopt":
				ctx.log.info(await adopt(ctx, need, url));
				return;
			case "wait":
				if (Date.now() >= deadline) {
					ctx.log.info(
						`The run still waits (${need.why}). Run \`splates ship next\` again.`,
					);
					return;
				}
		}
	}
}

/** What the agent does once `need` is adopted into its tree. */
function landing(need: Extract<AgentNeed, { kind: "land" }>): string {
	return [
		`${need.project} has its bump in task ${need.task}, in ${need.path}.`,
		"",
		`1. Work there: run the project's checks and repair what the new versions break, committing each repair.`,
		`2. Then \`splates ship land ${need.project}\`, which lands it through that project's own merge gate; the server publishes it after.`,
		`3. Then \`splates ship next\`.`,
		"",
		"If a break needs a public API change the approved plan did not have, or you cannot fix it, do not land: `splates ship land --stop` with `--why`, naming what a revised plan must resolve.",
	].join("\n");
}

async function adopt(
	ctx: AdoptContext,
	need: Extract<AgentNeed, { kind: "adopt" }>,
	url: string,
): Promise<string> {
	const repo = await openRepository(ctx, { at: need.root });
	try {
		const pins = need.adoption.takes.flatMap((take) => take.pins);
		const named = pins.map((pin) => `${pin.name} ${pin.version}`).join(", ");
		await add({ ...repo, log: ctx.log }, need.task, {
			goal: [
				`Take ${named}, from the ship of ${need.adoption.from}.`,
				...(need.adopt === null ? [] : [`Adopting: ${need.adopt}`]),
			].join("\n"),
		});
		const path = repo.service.pathFor(need.task);
		const moved = await movePins(ctx.fs, path, pins);
		if (moved.length === 0) {
			fail(
				"conflict",
				`${need.project} pins none of ${named}: nothing to move`,
			);
		}
		await run(ctx, path, ["bun", "install"]);
		for (const take of need.adoption.takes) {
			if (take.afterBump !== null) {
				await run(ctx, path, ["sh", "-c", take.afterBump]);
			}
		}
		const committed = await repo.git.commitAll(
			path,
			`Take ${named}, from the ship of ${need.adoption.from}`,
		);
		if (committed.code !== 0) {
			fail("conflict", `committing the bump failed: ${committed.stderr}`);
		}
		await askServer(
			ctx,
			[
				"POST",
				"/api/ship/run/adopted",
				{ project: need.project, task: need.task, path },
			],
			url,
		);
		return landing({
			kind: "land",
			project: need.project,
			task: need.task,
			path,
		});
	} finally {
		repo.dispose();
	}
}

/** Runs `command` in `cwd`, failing with what it printed when it exits non-zero. */
async function run(
	ctx: AdoptContext,
	cwd: string,
	command: string[],
): Promise<void> {
	const { exitCode, stdout, stderr } = await ctx.ps.spawnCapture(command, {
		cwd,
	});
	if (exitCode !== 0) {
		fail(
			"conflict",
			`\`${command.join(" ")}\` failed in ${cwd}; the task is adopted but its tree needs repair, then \`splates ship land\`:\n${(stderr || stdout).slice(-2000)}`,
		);
	}
}

/**
 * `splates ship land <project>`: lands the task the run opened in `project`
 * through that project's own merge gate, and tells the server, which then
 * publishes it. The run authorizes it: only the project the server names
 * as waiting on a landing, for the length of the run. A failed gate stops
 * the run, returning it to planning from what it published.
 */
export async function shipLand(
	ctx: AdoptContext,
	project: string,
	{ message = "", dev = "" }: { message?: string; dev?: string } = {},
): Promise<void> {
	const url = serverUrl(ctx, dev);
	const need = (await (
		await askServer(ctx, ["GET", "/api/ship/run/next", undefined], url)
	).json()) as AgentNeed;
	if (need.kind !== "land" || need.project !== project) {
		fail(
			"conflict",
			`the run is not waiting on a landing in ${project}: \`splates ship next\` says what it needs`,
		);
	}
	const repo = await openRepository(ctx, { at: await rootOf(ctx, need.path) });
	try {
		const facts = {};
		await merge({ ...ctx, ...repo }, need.path, facts, {
			message: message || `Take the ship's new versions of ${need.task}`,
		});
	} catch (error) {
		// Only the gate failing stops the run; a dirty tree or a conflict is
		// the agent's to mend before landing again.
		if ((error as { reason?: string }).reason !== "tests_failed") {
			throw error;
		}
		const why = error instanceof Error ? error.message : String(error);
		await askServer(
			ctx,
			[
				"POST",
				"/api/ship/run/stopped",
				{ project, why: `its gate failed: ${why}` },
			],
			url,
		);
		throw error;
	} finally {
		repo.dispose();
	}
	await askServer(ctx, ["POST", "/api/ship/run/landed", { project }], url);
	ctx.log.info(
		`${project} landed. The server publishes it next: \`splates ship next\`.`,
	);
}

/**
 * `splates ship land --stop`: stops the run at `project`, whose adoption
 * cannot land, saying why. What shipped stays published.
 */
export async function shipStop(
	ctx: AdoptContext,
	project: string,
	why: string,
	{ dev = "" }: { dev?: string } = {},
): Promise<void> {
	await askServer(
		ctx,
		["POST", "/api/ship/run/stopped", { project, why }],
		serverUrl(ctx, dev),
	);
	ctx.log.info(
		`The ship stopped at ${project}. \`splates ship start\` with no projects plans its recovery.`,
	);
}

/**
 * `splates ship handoff`: pauses the run and adds a task to this project's
 * list that resumes it with `splates ship next`, for when the agent's
 * context runs short. The agent asks the person to queue it.
 */
export async function shipHandoff(
	ctx: AdoptContext & Pick<Repository, "tasks">,
	{ dev = "" }: { dev?: string } = {},
): Promise<void> {
	const task = await ctx.tasks.add(
		"Resume the ship with `splates ship next`",
		null,
		{
			text: [
				"A ship is under way and its agent handed it off. Run `splates ship next`, which waits until the run needs you and prints exactly what to do, and carry on from there until it says the ship has ended.",
				"Land each dependent with `splates ship land <project>`; publish nothing yourself.",
			].join("\n"),
			ready: true,
		},
	);
	await askServer(
		ctx,
		["POST", "/api/ship/run/handoff", { task: task.id }],
		serverUrl(ctx, dev),
	);
	ctx.log.info(
		`Handed off as task #${task.id}. Ask the person to queue it with a queue card; \`splates ship next\` from it resumes the run.`,
	);
}

/** The main tree of the repository the worktree at `path` belongs to. */
async function rootOf(ctx: AdoptContext, path: string): Promise<string> {
	const { exitCode, stdout } = await ctx.ps.spawnCapture([
		"git",
		"-C",
		path,
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	]);
	if (exitCode !== 0) {
		fail("not_found", `${path} is not a git worktree`);
	}
	return stdout.trim().replace(/\/\.git$/, "");
}
