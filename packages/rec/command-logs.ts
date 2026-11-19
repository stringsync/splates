import type { Fs, Ps } from "core/system";
import type { Scrubber } from "./scrub";
import { parseStamp, sourceLine } from "./sources";

/** A `--logs` value: a name, how its offset-less stamps read, and the shell command that prints its lines. */
export interface CommandLogSpec {
	name: string;
	command: string;
	/** What a stamp with no offset means: local time, or UTC. */
	zone: "local" | "utc";
}

/** The span a command is asked for, in wall-clock ms. */
export interface LogWindow {
	since: number;
	until: number;
}

/** A command source as the manifest records it, so `rec logs fetch` can run it again. */
export interface CommandLog extends CommandLogSpec, LogWindow {
	/** The folder the command runs in, and whose `.env*` values are scrubbed. */
	cwd: string;
	/** Where its lines go, under the session folder. */
	file: string;
	/** `pending` until it has run; `cut` when the time or line cap stopped it. */
	status: "pending" | "ok" | "cut" | "failed";
	lines?: number;
	/** Why it failed or was cut. */
	note?: string;
	/** The command that fetches it again. */
	retry?: string;
}

/** How far before the recording a command's window opens. */
export const BEFORE_MS = 60_000;
/** How far after it the window closes: cloud logs take a while to arrive. */
export const AFTER_MS = 30_000;
export const TIMEOUT_MS = 60_000;
export const MAX_LINES = 20_000;

const SPEC = /^([A-Za-z0-9_-]+)(?:@(utc|local))?=(.+)$/s;

/** `<name>=<command>` or `<name>@utc=<command>`. */
export function parseLogsSpec(value: string): CommandLogSpec {
	const match = SPEC.exec(value);
	if (!match) {
		throw new Error(
			`--logs ${value}: expected <name>=<command> or <name>@utc=<command>, the name letters, digits, - or _`,
		);
	}
	const [, name = "", zone = "local", command = ""] = match;
	return { name, command, zone: zone as CommandLogSpec["zone"] };
}

/** Each `--logs` value parsed, refusing a name given twice. */
export function parseLogsSpecs(values: string[]): CommandLogSpec[] {
	const specs = values.map(parseLogsSpec);
	const seen = new Set<string>();
	for (const spec of specs) {
		if (seen.has(spec.name)) {
			throw new Error(`--logs ${spec.name} is given twice`);
		}
		seen.add(spec.name);
	}
	return specs;
}

/** The file a command source's lines go to. */
export function commandLogFile(name: string): string {
	return `logs/cmd-${name}.log`;
}

/** The window a recording's command sources are asked for. */
export function commandWindow(startedAt: number, stoppedAt: number): LogWindow {
	return { since: startedAt - BEFORE_MS, until: stoppedAt + AFTER_MS };
}

/** When a recording ran, in wall-clock ms. */
export interface RecordingSpan {
	startedAt: number;
	stoppedAt: number;
}

/** Command sources as a fresh session's manifest records them, not yet run; none without any. */
export function pendingCommandLogs(
	specs: CommandLogSpec[] = [],
	cwd: string,
	span: RecordingSpan,
): CommandLog[] | undefined {
	if (specs.length === 0) {
		return undefined;
	}
	const window = commandWindow(span.startedAt, span.stoppedAt);
	return specs.map((spec) => ({
		...spec,
		...window,
		cwd,
		file: commandLogFile(spec.name),
		status: "pending",
	}));
}

/** The command with `{since}`, `{until}` (ISO, UTC) and `{sinceMs}`, `{untilMs}` filled in. */
export function fillCommand(template: string, window: LogWindow): string {
	const values: Record<string, string> = {
		since: new Date(window.since).toISOString(),
		until: new Date(window.until).toISOString(),
		sinceMs: String(window.since),
		untilMs: String(window.until),
	};
	return template.replace(
		/\{(since|until|sinceMs|untilMs)\}/g,
		(_, key: string) => values[key] ?? "",
	);
}

/**
 * A command's output as stamped lines inside the window. A line without a
 * stamp takes the time of the stamped line before it (the window's start
 * when none came before), since every line arrives at once.
 */
export function stampLines(
	text: string,
	window: LogWindow,
	zone: CommandLogSpec["zone"],
): { at: number; text: string }[] {
	const out: { at: number; text: string }[] = [];
	let at = window.since;
	for (const raw of text.split("\n")) {
		const line = raw.replace(/\r$/, "");
		if (!line.trim()) {
			continue;
		}
		const stamp = parseStamp(line, { utc: zone === "utc" });
		at = stamp?.at ?? at;
		if (at >= window.since && at <= window.until) {
			out.push({ at, text: stamp?.rest ?? line });
		}
	}
	return out;
}

export interface RunCommandLogOptions {
	ps: Ps;
	fs: Fs;
	/** The session folder. */
	dir: string;
	scrubber: Scrubber;
	source: CommandLog;
	/** The command that fetches this source again, for the note when it fails. */
	retry: string;
	timeoutMs?: number;
	maxLines?: number;
}

/**
 * Runs a command source for its window and writes its lines, stamped and
 * scrubbed, over its file. It never throws: a failure is the status it returns.
 */
export async function runCommandLog(
	opts: RunCommandLogOptions,
): Promise<CommandLog> {
	const { source, timeoutMs = TIMEOUT_MS, maxLines = MAX_LINES } = opts;
	const command = fillCommand(source.command, source);
	const stop = new AbortController();
	const timer = setTimeout(() => stop.abort("time"), timeoutMs);
	let stdout = "";
	let stderr = "";
	let newlines = 0;
	let exitCode: number | undefined;
	let error: unknown;
	try {
		const result = await opts.ps.spawnCapture(["sh", "-c", command], {
			cwd: source.cwd,
			signal: stop.signal,
			watcher: {
				stdout: (chunk) => {
					stdout += chunk;
					newlines += chunk.split("\n").length - 1;
					if (newlines > maxLines) {
						stop.abort("lines");
					}
				},
				stderr: (chunk) => {
					stderr += chunk;
				},
			},
		});
		exitCode = result.exitCode;
		stdout ||= result.stdout;
		stderr ||= result.stderr;
	} catch (cause) {
		error = cause;
	} finally {
		clearTimeout(timer);
	}
	// What an earlier run said goes; JSON drops the undefined keys.
	const rest = {
		...source,
		lines: undefined,
		note: undefined,
		retry: undefined,
	};
	const cut = stop.signal.aborted ? (stop.signal.reason as string) : undefined;
	if (!cut && (error !== undefined || exitCode !== 0)) {
		const why =
			error !== undefined
				? error instanceof Error
					? error.message
					: String(error)
				: `exited ${exitCode}${stderr.trim() ? `: ${lastLine(stderr)}` : ""}`;
		return {
			...rest,
			status: "failed",
			note: opts.scrubber.scrub(`${source.name}: ${why}`),
			retry: opts.retry,
		};
	}
	const kept = cut ? stdout.split("\n").slice(0, maxLines).join("\n") : stdout;
	const lines = stampLines(kept, source, source.zone);
	await opts.fs.mkdir(`${opts.dir}/logs`, { recursive: true });
	await opts.fs.write(
		`${opts.dir}/${source.file}`,
		lines
			.map((line) => `${opts.scrubber.scrub(sourceLine(line.at, line.text))}\n`)
			.join(""),
	);
	if (cut) {
		return {
			...rest,
			status: "cut",
			lines: lines.length,
			note:
				cut === "lines"
					? `${source.name}: cut at ${maxLines} lines`
					: `${source.name}: cut after ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`}`,
			retry: opts.retry,
		};
	}
	return { ...rest, status: "ok", lines: lines.length };
}

function lastLine(text: string): string {
	return text.trim().split("\n").at(-1)?.slice(0, 300) ?? "";
}
