import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import type { Duration } from "webappwiz/time";
import { loadConfig } from "../config";
import { JobEvent } from "./job-route";
import { type JobSize, jobSize } from "./job-size";
import { type ServerSend, serverOf } from "./server-of";
import { statusLine } from "./status-line";

/** A heavy command to run on a runner, in the checkout of `cwd`. */
export interface RemoteJob {
	/** Anywhere in the worktree to run against; the job runs at the checkout's root. */
	cwd: string;
	argv: string[];
	env?: Record<string, string>;
	/** Names of files the command writes in `$SPLATES_JOB_FILES`, to come back. */
	files?: string[];
	/** Waits ahead of ordinary jobs, as a merge's gate does. */
	first?: boolean;
	/** What it asks of a runner where it overrides the project's `job` setting. */
	size?: Partial<JobSize>;
	/** Runs this commit, which the worktree's repository holds, rather than the worktree as it stands. */
	commit?: string;
	/** How long it may run on the runner before it is killed; none by default. */
	timeout?: Duration;
	/** Called with the command's output as it arrives. */
	output: (bytes: Uint8Array) => void;
	signal?: AbortSignal;
}

/** How a job on a runner ended. */
export interface RemoteJobResult {
	code: number;
	files: Map<string, Uint8Array>;
}

/**
 * Runs `job` on a runner through the `splates server` this agent runs under,
 * streaming its output to `job.output`. Null where it cannot go that way,
 * for the caller to run it here: no server to ask, no runner to be had for
 * it, or `cwd` is no git checkout. A job that started and then failed throws.
 */
export async function runOnRunner(
	ctx: { ps: Ps; fs: Fs; log: Logger; dev?: string; send?: ServerSend },
	job: RemoteJob,
): Promise<RemoteJobResult | null> {
	const server = await serverOf(ctx);
	if (server === null) {
		return null;
	}
	const toplevel = await git(ctx.ps, job.cwd, ["rev-parse", "--show-toplevel"]);
	const common = await git(ctx.ps, job.cwd, [
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	]);
	if (toplevel === null || common === null) {
		return null;
	}
	const config = await loadConfig(toplevel, { fs: ctx.fs });
	const size = jobSize(config.job, job.size);
	let response: Response;
	try {
		response = await server.send(`${server.url}/api/jobs`, {
			method: "POST",
			// A write names its own origin, as the server asks of every one.
			headers: { "content-type": "application/json", origin: server.url },
			body: JSON.stringify({
				worktree: toplevel,
				project: common,
				task: ctx.ps.env("SPLATES_TASK") ?? null,
				prepare: config.prepare,
				argv: job.argv,
				env: job.env ?? {},
				files: job.files ?? [],
				first: job.first ?? false,
				cpus: size.cpus,
				memory: size.memory,
				...(job.commit === undefined ? {} : { commit: job.commit }),
				...(job.timeout === undefined ? {} : { timeoutMs: job.timeout.ms }),
			}),
			// Bun's fetch drops a response silent for 360 s, as the stream is
			// while the job waits in line or its command prints nothing.
			timeout: false,
			...(job.signal === undefined ? {} : { signal: job.signal }),
		} as RequestInit);
	} catch (error) {
		ctx.log.info(`cannot reach splates server for a runner: ${String(error)}`);
		return null;
	}
	if (!response.ok) {
		const said = (await response.json().catch(() => null)) as {
			reason?: string;
		} | null;
		// What a server before the pool answered for want of a runner.
		if (said?.reason === "no_runner") {
			return null;
		}
		throw new Error(
			`splates server refused the job: ${said?.reason ?? response.status}`,
		);
	}
	return await read(response, job, ctx.log);
}

async function read(
	response: Response,
	job: RemoteJob,
	log: Logger,
): Promise<RemoteJobResult | null> {
	const files = new Map<string, Uint8Array>();
	let code: number | null = null;
	let local = false;
	const decoder = new TextDecoder();
	let pending = "";
	const handle = (line: string) => {
		const event = JobEvent.parse(JSON.parse(line));
		switch (event.type) {
			case "out":
				job.output(new Uint8Array(Buffer.from(event.data, "base64")));
				break;
			case "file":
				files.set(
					event.name,
					new Uint8Array(Buffer.from(event.data, "base64")),
				);
				break;
			case "exit":
				code = event.code;
				break;
			case "queued":
				statusLine(
					`waiting for a runner of splates server's, ${event.position} in line`,
					color.yellow,
				);
				break;
			case "local":
				local = true;
				if (event.tooBig !== undefined) {
					log.error(tooBigLine(event.tooBig.asked, event.tooBig.largest));
				}
				break;
			case "error":
				throw new Error(`the job failed on its runner: ${event.reason}`);
		}
	};
	for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
		pending += decoder.decode(chunk, { stream: true });
		const lines = pending.split("\n");
		pending = lines.pop() ?? "";
		for (const line of lines) {
			if (line !== "") {
				handle(line);
			}
		}
	}
	if (pending !== "") {
		handle(pending);
	}
	if (local) {
		return null;
	}
	if (code === null) {
		throw new Error(
			"the connection to splates server ended before the job did",
		);
	}
	return { code, files };
}

/** What a caller is told of a job no runner has room for, which it runs here. */
export function tooBigLine(asked: JobSize, largest: JobSize): string {
	return `no runner has ${sizeText(asked)}, the biggest has ${sizeText(largest)}: running it here. Ask for less with \`splates run --cpus --memory\` or the project's \`job\` in splates.config.ts`;
}

function sizeText(size: JobSize): string {
	return `${size.cpus} ${size.cpus === 1 ? "CPU" : "CPUs"} and ${size.memory} GB`;
}

async function git(
	ps: Ps,
	cwd: string,
	args: string[],
): Promise<string | null> {
	const { exitCode, stdout } = await ps
		.spawnCapture(["git", "-C", cwd, ...args])
		.catch(() => ({ exitCode: 1, stdout: "" }));
	return exitCode === 0 ? stdout.trim() : null;
}
