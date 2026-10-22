import type { WallClock } from "webappwiz/time";
import type { DirectRun } from "./direct";
import type { DirectJobReport, DirectPhase } from "./direct-runner-report";
import {
	type DirectJob,
	directFilesScript,
	directJobScript,
	jobRef,
	STARTED_LINE,
} from "./direct-script";
import type { RunnerHost, RunnerShell } from "./direct-ssh";
import type { RunnerLedger } from "./runner-ledger";

/**
 * Runs `job` on `host`, its room reserved there: pushes its commit, runs
 * the prepare step and the command, telling each step, streams their
 * output, brings its files back, and keeps it in the ledger.
 */
export async function runOnHost(
	deps: { shell: RunnerShell; ledger: RunnerLedger | null },
	host: RunnerHost,
	{ id, project, job, tell, wall }: HostedJob,
): Promise<{ code: number; files: Map<string, Uint8Array> }> {
	const at = new Date(wall.now()).toISOString();
	const { shell } = deps;
	tell("sending", `on ${host.id} (${host.address}): sending the worktree`, {
		runner: host.id,
	});
	await shell.push(host, job.cwd, job.commit, project, jobRef(id));
	const spec: DirectJob = {
		id,
		project,
		commit: job.commit,
		size: job.size,
		argv: job.argv,
		env: job.env,
		prepare: job.prepare,
		timeout: job.timeout === null ? null : Math.ceil(job.timeout.secs),
		files: job.files.length > 0,
	};
	const running = () =>
		tell("running", `running ${shortened(job.argv.join(" "))}`);
	if (job.prepare === null) {
		running();
	} else {
		tell("preparing", `preparing: ${shortened(job.prepare)}`);
	}
	const child = shell.start(host, directJobScript(spec));
	const hangUp = () => void child.stdin.close().catch(() => {});
	job.signal?.addEventListener("abort", hangUp, { once: true });
	const pump = async (stream: ReadableStream<Uint8Array>, marked: boolean) => {
		for await (const bytes of stream) {
			const at = marked ? markAt(bytes) : -1;
			if (at === -1) {
				job.output(bytes);
				continue;
			}
			// The script's mark that the prepare step is done, never shown.
			running();
			job.output(bytes.subarray(0, at));
			job.output(bytes.subarray(at + STARTED_MARK.length));
		}
	};
	let code: number;
	try {
		await Promise.all([
			pump(child.stdout, false),
			pump(child.stderr, job.prepare !== null),
		]);
		code = await child.exited;
	} finally {
		job.signal?.removeEventListener("abort", hangUp);
	}
	const files = new Map<string, Uint8Array>();
	if (job.files.length > 0) {
		const sent = await shell.capture(
			host,
			directFilesScript({ id, project: spec.project, names: job.files }),
		);
		for (const line of sent.stdout.split("\n")) {
			const tab = line.indexOf("\t");
			if (tab > 0) {
				files.set(
					line.slice(0, tab),
					new Uint8Array(Buffer.from(line.slice(tab + 1), "base64")),
				);
			}
		}
	}
	await deps.ledger
		?.note({
			row: "job",
			id,
			runner: host.id,
			project: job.project,
			task: job.task,
			what: job.argv.join(" ").slice(0, 200),
			at,
			until: new Date(wall.now()).toISOString(),
		})
		.catch(() => {});
	return { code, files };
}

/** What `runOnHost` runs. */
export interface HostedJob {
	id: string;
	/** The project's key on the runner. */
	project: string;
	job: DirectRun;
	tell: Tell;
	wall: WallClock;
}

/** Moves a job's report to `phase`, with a line for the person when it is new. */
export type Tell = (
	phase: DirectPhase,
	line: string | null,
	patch?: Partial<DirectJobReport>,
) => void;

/** What the job script writes on stderr once the prepare step is done, for the running step to be told. */
const STARTED_MARK = new TextEncoder().encode(STARTED_LINE);

/** Where `STARTED_MARK` starts in `bytes`; -1 when it is not there. */
function markAt(bytes: Uint8Array): number {
	for (
		let at = bytes.indexOf(STARTED_MARK[0] as number);
		at !== -1;
		at = bytes.indexOf(STARTED_MARK[0] as number, at + 1)
	) {
		if (STARTED_MARK.every((byte, offset) => bytes[at + offset] === byte)) {
			return at;
		}
	}
	return -1;
}

/** `text` cut to a line's worth. */
function shortened(text: string): string {
	return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
