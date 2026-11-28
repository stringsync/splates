import { fail } from "@splates/server/exit";
import type { Repository } from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import {
	describeRun,
	KeptRuns,
	runLine,
	stepOutput,
} from "@splates/server/ship";
import type { Storage } from "@splates/server/storage";
import { SERVER_WAIT_MS } from "@splates/server/tasks";
import { serverOf } from "@splates/server/workers";
import { here } from "./flags";

/** Which failed step `retryStep` sends round again, in which run. */
export interface RetryStepOptions {
	run: string;
	target: string;
	step: string;
	dev: string;
}

/** What `noteOnRun` posts, and to which run, target and step. */
export interface NoteOnRunOptions {
	run: string;
	text: string;
	target: string;
	step: string;
	link: string;
	dev: string;
}

/** The run `postToRun` posts to, and the dev server to find. */
interface PostToRunOptions {
	run: string;
	dev: string;
}

/**
 * Asks the server to send failed step `step` of `target` in run `run` round
 * again for the task this worktree is: any task may carry a ship on.
 */
export async function retryStep(
	ctx: SplatesDeps & Repository,
	opts: RetryStepOptions,
): Promise<string> {
	await postToRun(ctx, "retry", { target: opts.target, step: opts.step }, opts);
	return `${opts.target}/${opts.step} goes round again: \`splates ships show ${opts.run}\` follows it`;
}

/** Adds a note from the task this worktree is to ship run `run`. */
export async function noteOnRun(
	ctx: SplatesDeps & Repository,
	opts: NoteOnRunOptions,
): Promise<string> {
	if ((opts.target === "") !== (opts.step === "")) {
		fail("usage", "name both --target and --step, or neither", {});
	}
	await postToRun(
		ctx,
		"note",
		{
			text: opts.text,
			...(opts.target !== "" && { target: opts.target, step: opts.step }),
			...(opts.link !== "" && { link: opts.link }),
		},
		opts,
	);
	return `noted on ship run ${opts.run}: \`splates ships show ${opts.run}\` lists it`;
}

/** Posts `body`, with this worktree's task, to the server's `action` for run `opts.run`. */
async function postToRun(
	ctx: SplatesDeps & Repository,
	action: "retry" | "note",
	body: Record<string, unknown>,
	opts: PostToRunOptions,
): Promise<void> {
	const task = await here(ctx);
	if (task === null) {
		fail(
			"usage",
			"run it from the worktree of a task: the run records which task acted",
			{},
		);
	}
	const server = await serverOf({ ...ctx, dev: opts.dev });
	const slug = (await ctx.projects.list()).find(
		(each) => each.root === ctx.git.root,
	)?.slug;
	if (server === null || slug === undefined) {
		fail(
			"not_found",
			"no splates server runs this project: a ship runs only on its server",
			{},
		);
	}
	const path = action === "note" ? "note" : "fix-retry";
	const response = await server
		.send(
			`${server.url}/api/ship/runs/${encodeURIComponent(opts.run)}/${path}?project=${encodeURIComponent(slug)}`,
			{
				method: "POST",
				headers: {
					origin: server.url,
					"content-type": "application/json",
				},
				body: JSON.stringify({ ...body, task }),
				signal: AbortSignal.timeout(SERVER_WAIT_MS),
			},
		)
		.catch((error: unknown) =>
			fail("not_found", `the splates server did not answer: ${error}`, {}),
		);
	if (!response.ok) {
		const { error } = (await response.json().catch(() => ({}))) as {
			error?: string;
		};
		fail(
			response.status === 404 ? "not_found" : "usage",
			error ?? `the server refused: ${response.status}`,
			{ run: opts.run },
		);
	}
}

/** Every ship run kept, a line each, newest first. */
export async function shipRunsText({
	storage,
}: {
	storage: Storage;
}): Promise<string> {
	const runs = await new KeptRuns(storage).list();
	return runs.length === 0 ? "no ship runs yet" : runs.map(runLine).join("\n");
}

/**
 * Ship run `run`, the newest when "", from its file; with `target` and
 * `step`, everything that step printed on its last try.
 */
export async function shipRunText({
	storage,
	run,
	target,
	step,
}: {
	storage: Storage;
	run: string;
	target: string;
	step: string;
}): Promise<string> {
	const kept = new KeptRuns(storage);
	const id = run || (await kept.list())[0]?.id || "";
	const found = await kept.read(id);
	if (found === null) {
		fail(
			"not_found",
			id === "" ? "no ship runs yet" : `no ship run is "${id}"`,
			{
				run: id,
			},
		);
	}
	if ((target === "") !== (step === "")) {
		fail("usage", "name both --target and --step, or neither", {});
	}
	if (step === "") {
		return describeRun(found.state);
	}
	const at = found.state.targets
		.find((each) => each.name === target)
		?.steps.find((each) => each.id === step);
	if (at === undefined) {
		fail("not_found", `run ${id} has no step "${step}" of ${target}`, {
			run: id,
		});
	}
	const output = stepOutput(found.events, target, step);
	return [
		`${target}/${step}: ${at.status}, ${at.does}`,
		...(at.error === undefined ? [] : [`error: ${at.error}`]),
		"",
		output.trimEnd() || "(it printed nothing)",
	].join("\n");
}
