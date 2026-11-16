import type { Resource } from "core/disposable";
import type { Ps } from "core/system";
import { z } from "zod";
import { PROMPT } from "./run-events";
import { lastLines, quoted } from "./shell";
import type { Bump } from "./wire";

/** Which step to ask about, and the flags its target is planned with. */
export type StepRequest = {
	command: string;
	target: string;
	step: string;
	bump?: Bump;
	/** What each upstream released, as `--upstream <name>=<version>`. */
	upstream: Record<string, string>;
};

/** A line a step's `run` writes, as splates reads it. */
export const RUN_LINE = z.union([
	z.object({ type: z.literal("output"), text: z.string() }),
	z.object({ type: z.literal("update"), line: z.string() }),
	z.object({ type: z.literal("error"), message: z.string() }),
	z.object({ type: z.literal("withdrawn"), id: z.string() }),
	z.object({ type: z.literal("released"), version: z.string() }),
	z.object({ type: z.literal("prompt"), id: z.string() }).and(PROMPT),
]);
export type RunLine = z.infer<typeof RUN_LINE>;

/** A step's `run` under way. */
export interface RunningStep extends Resource {
	pid: number | null;
	/** Each line it writes, ending when it exits. */
	lines: AsyncIterable<RunLine>;
	/** Answers prompt `id` on its stdin. */
	answer(id: string, value: unknown): Promise<void>;
	/** Ends its process: what stopping its run does. */
	/** Its exit code once it is gone. */
	exited: Promise<number>;
}

/** What `done` answered: whether the step happened, and any version it found out. */
export type DoneAnswer = { done: boolean; released?: string };

/** Runs the requests of `serve` in `core/ship`: `done` and `run` of one step. */
export interface StepProcesses {
	done(request: StepRequest): Promise<DoneAnswer>;
	run(request: StepRequest): RunningStep;
	/** Whether the process `pid`, a run cut short, is still at work. */
	alive(pid: number): boolean;
}

/** How long a step's `done` has to answer. */
const DONE_TIMEOUT_MS = 10 * 60 * 1000;

/** {@link StepProcesses} through each target's ship command, from `root`. */
export class ShellStepProcesses implements StepProcesses {
	constructor(
		private readonly ps: Pick<Ps, "spawnCapture" | "start" | "alive">,
		private readonly root: string,
	) {}

	async done(request: StepRequest): Promise<DoneAnswer> {
		const line = commandLine(request, "done");
		const result = await this.ps.spawnCapture(["sh", "-c", line], {
			cwd: this.root,
			stdin: "",
			timeoutMs: DONE_TIMEOUT_MS,
		});
		const said = result.stdout.trim();
		if (result.exitCode !== 0 || (said !== "true" && said !== "false")) {
			const why = lastLines(result.stderr || result.stdout);
			throw new Error(
				`"${request.command} done ${request.step}" exited ${result.exitCode}${why ? `: ${why}` : ""}`,
			);
		}
		// A done that finds the release already out says so on stderr, as a
		// released line among whatever else it printed.
		let released: string | undefined;
		for (const each of result.stderr.split("\n")) {
			const read = readLine(each);
			if (read?.type === "released") {
				released = read.version;
			}
		}
		return {
			done: said === "true",
			...(released !== undefined && { released }),
		};
	}

	run(request: StepRequest): RunningStep {
		const child = this.ps.start(["sh", "-c", commandLine(request, "run")], {
			cwd: this.root,
		});
		const writer = child.stdin.getWriter();
		const encoder = new TextEncoder();
		// stderr is only drained, so a child writing much there never blocks.
		void child.stderr.pipeTo(new WritableStream()).catch(() => {});
		return {
			pid: child.pid,
			lines: linesOf(child.stdout),
			answer: (id, value) =>
				writer.write(
					encoder.encode(`${JSON.stringify({ type: "answer", id, value })}\n`),
				),
			dispose: () => child.kill(),
			exited: child.exited.finally(() => writer.close().catch(() => {})),
		};
	}

	alive(pid: number): boolean {
		return this.ps.alive(pid);
	}
}

/** The shell line of `request` for `kind`, with the flags it plans with. */
export function commandLine(
	request: StepRequest,
	kind: "done" | "run",
): string {
	const words = [
		kind,
		request.step,
		"--target",
		request.target,
		...(request.bump ? ["--bump", request.bump] : []),
		...Object.entries(request.upstream).flatMap(([name, version]) => [
			"--upstream",
			`${name}=${version}`,
		]),
	];
	return [request.command, ...words.map(quoted)].join(" ");
}

/** The run lines `stream` carries; a line that is none reads as output. */
async function* linesOf(
	stream: ReadableStream<Uint8Array>,
): AsyncIterable<RunLine> {
	const decoder = new TextDecoder();
	let partial = "";
	for await (const chunk of stream) {
		const lines = (partial + decoder.decode(chunk, { stream: true })).split(
			"\n",
		);
		partial = lines.pop() ?? "";
		for (const line of lines) {
			const read = readLine(line);
			if (read !== null) {
				yield read;
			}
		}
	}
	const read = readLine(partial + decoder.decode());
	if (read !== null) {
		yield read;
	}
}

function readLine(line: string): RunLine | null {
	if (!line.trim()) {
		return null;
	}
	try {
		const parsed = RUN_LINE.safeParse(JSON.parse(line));
		if (parsed.success) {
			return parsed.data;
		}
	} catch {
		// not JSON: what the command printed past serve
	}
	return { type: "output", text: `${line}\n` };
}
