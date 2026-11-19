import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { MemoryLogger } from "core/log";
import { NodePs } from "core/system";
import { FakeFs, FakePs } from "core/system/testing";
import {
	type CommandLog,
	commandWindow,
	fillCommand,
	parseLogsSpec,
	parseLogsSpecs,
	pendingCommandLogs,
	runCommandLog,
	stampLines,
} from "./command-logs";
import { fetchCommandLogs } from "./rec";
import { Scrubber } from "./scrub";
import type { Manifest } from "./session";

const START = Date.parse("2026-11-17T12:00:00.000Z");
const STOP = Date.parse("2026-11-17T12:05:00.000Z");
const WINDOW = commandWindow(START, STOP);

function source(command: string, zone: "local" | "utc" = "utc"): CommandLog {
	const [log] =
		pendingCommandLogs([{ name: "api", command, zone }], "/", {
			startedAt: START,
			stoppedAt: STOP,
		}) ?? [];
	return log as CommandLog;
}

test("--logs takes a name, an optional zone and a command", () => {
	expect(parseLogsSpec("api=bin/s2s logs staging")).toEqual({
		name: "api",
		command: "bin/s2s logs staging",
		zone: "local",
	});
	expect(parseLogsSpec("api@utc=aws logs tail x=y")).toEqual({
		name: "api",
		command: "aws logs tail x=y",
		zone: "utc",
	});
	expect(() => parseLogsSpec("no command")).toThrow();
	expect(() => parseLogsSpec("a/b=x")).toThrow();
	expect(() => parseLogsSpecs(["a=x", "a@utc=y"])).toThrow(/twice/);
});

test("the window opens a minute before and closes 30 seconds after", () => {
	expect(WINDOW).toEqual({ since: START - 60_000, until: STOP + 30_000 });
	expect(
		fillCommand("logs --from {since} --to {until} {sinceMs}-{untilMs}", WINDOW),
	).toBe(
		`logs --from 2026-11-17T11:59:00.000Z --to 2026-11-17T12:05:30.000Z ${START - 60_000}-${STOP + 30_000}`,
	);
});

test("lines outside the window are dropped, and stampless ones follow the line before", () => {
	const text = [
		"2026-11-17T11:00:00Z too early",
		"  at stack of the early line",
		"2026-11-17T12:01:00.250Z ERROR boom",
		"  at handler (x.ts:1)",
		"",
		"2026-11-17T13:00:00Z too late",
	].join("\n");
	expect(stampLines(text, WINDOW, "utc")).toEqual([
		{ at: Date.parse("2026-11-17T12:01:00.250Z"), text: "ERROR boom" },
		{
			at: Date.parse("2026-11-17T12:01:00.250Z"),
			text: "  at handler (x.ts:1)",
		},
	]);
});

test("offset-less stamps read as UTC only for an @utc source; stated offsets always hold", () => {
	const bare = "2026-11-17 12:01:00 hello";
	expect(stampLines(bare, WINDOW, "utc")[0]?.at).toBe(
		Date.parse("2026-11-17T12:01:00Z"),
	);
	expect(stampLines(bare, WINDOW, "local")[0]?.at).toBe(
		Date.parse("2026-11-17T12:01:00"),
	);
	const offset = "2026-11-17T14:01:00+02:00 hello";
	expect(stampLines(offset, WINDOW, "local")[0]?.at).toBe(
		Date.parse("2026-11-17T12:01:00Z"),
	);
});

test("a command's lines are stamped and scrubbed into its file", async () => {
	const fs = new FakeFs();
	const ps = new FakePs();
	ps.setCaptureOutput(
		"2026-11-17T12:01:00Z ERROR token sekret-value-123 failed\n",
		"",
	);
	const result = await runCommandLog({
		ps,
		fs,
		dir: "/s",
		scrubber: new Scrubber({ TOKEN: "sekret-value-123" }),
		source: source("bin/logs {since}"),
		retry: "rec logs fetch s --source api",
	});
	expect(result.status).toBe("ok");
	expect(result.lines).toBe(1);
	expect(await fs.read("/s/logs/cmd-api.log")).toBe(
		"2026-11-17T12:01:00.000Z ERROR ERROR token [REDACTED:TOKEN] failed\n",
	);
});

test("a failing command leaves a retryable note and no file", async () => {
	const fs = new FakeFs();
	const ps = new FakePs();
	ps.setCaptureOutput("", "Error: the SSO session has expired\n");
	ps.simulate(() => Promise.resolve(255));
	const result = await runCommandLog({
		ps,
		fs,
		dir: "/s",
		scrubber: new Scrubber(),
		source: source("aws logs tail"),
		retry: "rec logs fetch s --source api",
	});
	expect(result.status).toBe("failed");
	expect(result.note).toBe(
		"api: exited 255: Error: the SSO session has expired",
	);
	expect(result.retry).toBe("rec logs fetch s --source api");
	expect(await fs.exists("/s/logs/cmd-api.log")).toBe(false);
});

test("rewrites the file and clears the old note when run again", async () => {
	const fs = new FakeFs();
	await fs.mkdir("/s/logs", { recursive: true });
	await fs.write("/s/logs/cmd-api.log", "old line\n");
	const ps = new FakePs();
	ps.setCaptureOutput("2026-11-17T12:02:00Z new line\n", "");
	const result = await runCommandLog({
		ps,
		fs,
		dir: "/s",
		scrubber: new Scrubber(),
		source: { ...source("x"), status: "failed", note: "api: old", retry: "r" },
		retry: "r",
	});
	expect(result).toMatchObject({ status: "ok", lines: 1 });
	expect(result.note).toBeUndefined();
	expect(await fs.read("/s/logs/cmd-api.log")).toBe(
		"2026-11-17T12:02:00.000Z INFO  new line\n",
	);
});

test("a command is cut at its line cap and its time cap", async () => {
	const dir = await mkdtemp(`${tmpdir()}/rec-cmd-`);
	const fs = new FakeFs();
	const ps = new NodePs();
	const many = await runCommandLog({
		ps,
		fs,
		dir: "/s",
		scrubber: new Scrubber(),
		source: {
			...source(
				"i=0; while [ $i -lt 50 ]; do echo 2026-11-17T12:01:00Z line $i; i=$((i+1)); done",
			),
			cwd: dir,
		},
		retry: "r",
		maxLines: 10,
	});
	expect(many).toMatchObject({ status: "cut", lines: 10 });
	expect(many.note).toBe("api: cut at 10 lines");
	const slow = await runCommandLog({
		ps,
		fs,
		dir: "/s",
		scrubber: new Scrubber(),
		source: {
			...source("echo 2026-11-17T12:01:00Z first; sleep 5"),
			cwd: dir,
		},
		retry: "r",
		timeoutMs: 300,
	});
	expect(slow).toMatchObject({ status: "cut", lines: 1 });
	expect(slow.note).toBe("api: cut after 300ms");
});

test("a session's fetch records each run in its manifest and redoes its signals", async () => {
	const fs = new FakeFs();
	const ps = new FakePs();
	const dir = "/home/u/.rec/sessions/s";
	const [pending] =
		pendingCommandLogs(
			[
				{ name: "api", command: "logs {since}", zone: "utc" },
				{ name: "web", command: "other", zone: "local" },
			],
			"/proj",
			{ startedAt: START, stoppedAt: STOP },
		) ?? [];
	await fs.mkdir("/proj", { recursive: true });
	await fs.write("/proj/.env", "API_TOKEN=very-secret-token\n");
	await fs.mkdir(dir, { recursive: true });
	await fs.write(
		`${dir}/manifest.json`,
		JSON.stringify({
			name: "brave-otter",
			startedAt: START,
			files: {},
			commandLogs: [
				pending,
				{ ...pending, name: "web", file: "logs/cmd-web.log" },
			],
		}),
	);
	ps.setCaptureOutput(
		"2026-11-17T12:01:00Z ERROR auth very-secret-token rejected\n",
		"",
	);
	const log = new MemoryLogger();
	const deps = { fs, ps, log, wall: { now: () => STOP } } as never;
	expect(await fetchCommandLogs(deps, dir, "api")).toBe(1);
	const manifest = JSON.parse(
		await fs.read(`${dir}/manifest.json`),
	) as Manifest;
	expect(manifest.commandLogs?.map((source) => source.status)).toEqual([
		"ok",
		"pending",
	]);
	expect(manifest.files["cmd:api"]).toBe("logs/cmd-api.log");
	expect(await fs.read(`${dir}/logs/cmd-api.log`)).toContain(
		"[REDACTED:API_TOKEN]",
	);
	expect(await fs.read(`${dir}/moments.jsonl`)).toContain("logs/cmd-api.log");
	expect(fetchCommandLogs(deps, dir, "db")).rejects.toThrow(
		/no --logs source db; it has api, web/,
	);
});
