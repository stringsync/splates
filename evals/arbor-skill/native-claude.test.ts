import { afterEach, beforeEach, expect, it } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeRequest, NativeUpdate } from "./native-adapter";
import { nativeAdapter } from "./native-adapter";
import { type ClaudeLaunch, claudeDriver } from "./native-claude";
import type { Probe } from "./probe";

// scry-ignore simple-test-setup: only this test collects the complete success stream and checks the inert factory before running it.
it("preserves native skill bytes, selected model/tools and cumulative multi-model estimates without certifying tools", async () => {
	const transport = fixture(await success());
	const driver = claudeDriver({ allowance, launch: transport.launch });
	const updates: NativeUpdate[] = [];
	const session = driver.create(request);
	expect(transport.calls).toHaveLength(0);
	expect(driver.limits).toEqual({ tokens: "monitored", costUsd: "monitored" });
	await session.run((update) => updates.push(update));
	await session.dispose();
	expect(transport.completed).toBe(3);
	const invocation = transport.calls[2];
	expect(invocation?.input).toBe("answer");
	expect(invocation?.env).toEqual(request.context.env);
	expect(invocation?.argv).toContain("claude-sonnet-4-6");
	expect(invocation?.argv).toContain("dontAsk");
	expect(invocation?.argv).toContain("0.005");
	expect(invocation?.argv).not.toContain("--bare");
	expect(
		await readFile(
			join(
				request.context.isolation.repository,
				".claude/skills/arbor/references/test.md",
			),
			"utf8",
		),
	).toBe("reference bytes");
	expect(updates.filter((update) => update.kind === "usage")).toEqual([
		{ kind: "usage", tokens: 20, costUsd: null, final: false },
		{ kind: "usage", tokens: 22, costUsd: null, final: false },
		{ kind: "usage", tokens: 40, costUsd: 0.002, final: false },
	]);
	expect(updates.at(-1)).toEqual({ kind: "reply", text: "done" });
	expect(updates.some((update) => update.kind === "event")).toBe(false);
	expect(request.context.evidence.complete).toEqual([]);
});

it("explicitly invokes the native skill with the declared shell capability", async () => {
	request.skill.mode = "explicit";
	request.tools = ["shell", "arbor", "git", "read"];
	const transport = fixture(await success());
	const session = claudeDriver({ allowance, launch: transport.launch }).create(
		request,
	);
	await session.run(() => {});
	await session.dispose();
	expect(transport.calls[2]?.input).toBe("/arbor answer");
	expect(transport.calls[2]?.argv).toContain("Bash,Read,Glob,Grep,Skill");
});

it.each([
	{ missing: "auth", opts: { auth: false }, overrides: {} },
	{ missing: "capability", opts: { help: "--model" }, overrides: {} },
	{ missing: "tool", opts: {}, overrides: { tools: ["mystery"] } },
	{ missing: "model", opts: {}, overrides: { model: null } },
	{
		missing: "exclusive named shell permissions",
		opts: {},
		overrides: { tools: ["arbor", "git", "read"] },
	},
])(
	"refuses missing $missing before submitting a prompt",
	async ({ opts, overrides }) => {
		Object.assign(request, overrides);
		const transport = fixture(await success(), opts);
		const session = claudeDriver({
			allowance,
			launch: transport.launch,
		}).create(request);
		await session.run(() => {});
		await session.dispose();
		expect(request.context.evidence.termination).toBe("unsupported");
		expect(transport.calls).not.toContainEqual(
			expect.objectContaining({ input: "answer" }),
		);
	},
);

it("refuses event stops before starting a process", async () => {
	request.context.probe.stop = {
		kind: "event",
		match: { actor: "agent", kind: "read", name: "Read" },
	};
	const transport = fixture("");
	const session = claudeDriver({ allowance, launch: transport.launch }).create(
		request,
	);
	await session.run(() => {});
	await session.dispose();
	expect(request.context.evidence.termination).toBe("unsupported");
	expect(transport.calls).toEqual([]);
});

it.each([
	"broken JSON\n",
	'{"type":"result","subtype":"error_during_execution","is_error":true}\n',
	"",
])("fails closed on malformed/error/interrupted output: %s", async (output) => {
	const transport = fixture(output);
	const session = claudeDriver({ allowance, launch: transport.launch }).create(
		request,
	);
	await expect(session.run(() => {})).rejects.toThrow();
	await session.dispose();
	expect(transport.completed).toBe(3);
});

it("keeps missing usage unknown and zeroed startup errors incomplete", async () => {
	const transport = fixture(
		'{"type":"result","subtype":"error_during_execution","is_error":true,"startup_failure_reason":"authentication_failed","total_cost_usd":0,"modelUsage":{}}\n',
	);
	const updates: NativeUpdate[] = [];
	const session = claudeDriver({ allowance, launch: transport.launch }).create(
		request,
	);
	await expect(session.run((update) => updates.push(update))).rejects.toThrow();
	await session.dispose();
	expect(updates.filter((update) => update.kind === "usage")).toEqual([
		{ kind: "usage", tokens: null, costUsd: null, final: false },
	]);
});

it("marks native budget exhaustion as a bound with possible overshoot", async () => {
	const transport = fixture(
		'{"type":"result","subtype":"error_max_budget_usd","is_error":true,"total_cost_usd":0.006}\n',
		{ code: 1 },
	);
	const session = claudeDriver({ allowance, launch: transport.launch }).create(
		request,
	);
	await session.run(() => {});
	await session.dispose();
	expect(request.context.evidence.termination).toBe("bound");
	expect(request.context.evidence.detail).toContain("overshoot");
});

// scry-ignore simple-test-setup: the abort controller and partial held stream belong only to this cancellation case.
it("shared cancellation stops an active transport, awaits disposal, and retains partial usage", async () => {
	const controller = new AbortController();
	request.context.signal = controller.signal;
	const transport = fixture(
		`${(await success()).split("\n").slice(0, 2).join("\n")}\n`,
		{ hold: true },
	);
	const driver = claudeDriver({ allowance, launch: transport.launch });
	request.context.reportUsage = (usage) => {
		request.context.usage.tokens = usage.tokens;
		controller.abort();
	};
	await nativeAdapter(driver, request.skill).metering?.run(
		request.context,
		request.model,
		allowance,
	);
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
	expect(transport.completed).toBe(3);
	expect(transport.cancelled).toBe(3);
	expect(request.context.usage.tokens).toBe(20);
	expect(request.context.runtime.nativeUsageComplete).toBe(false);
	expect(request.context.evidence.reply).toBeUndefined();
});

// scry-ignore simple-test-setup: this executable fixture belongs only to the real-spawn transport test, unlike injected transports.
it("owns a real free process transport and handles missing executable startup", async () => {
	const executable = join(directory, "fake-claude");
	await writeFile(
		executable,
		`#!/usr/bin/env bun\nconst args = process.argv.slice(2);\nif (args[0] === '--help') console.log(${JSON.stringify(help)});\nelse if(args[0] === 'auth') console.log('{"loggedIn":true}');\nelse { await Bun.stdin.text(); console.log(${JSON.stringify(await success())}); }\n`,
	);
	await chmod(executable, 0o755);
	const updates: NativeUpdate[] = [];
	const session = claudeDriver({ allowance, executable }).create(request);
	await session.run((update) => updates.push(update));
	await session.dispose();
	expect(updates.at(-1)).toEqual({ kind: "reply", text: "done" });
	const missing = claudeDriver({
		allowance,
		executable: join(directory, "absent"),
	}).create(request);
	await missing.run(() => {});
	await missing.dispose();
	expect(request.context.evidence.detail).toBe("Claude executable unavailable");
});

let directory: string;
let request: NativeRequest;
const cleanups: (() => void | Promise<void>)[] = [];
const allowance = { tokens: 100, microUsd: 5000 };
const help =
	"--model --tools --allowedTools --permission-mode --permission-prompts --max-budget-usd --output-format --setting-sources --strict-mcp-config --no-session-persistence";
const probe: Probe = {
	schema: 1,
	id: "claude",
	version: "1",
	requirement: { id: "free", text: "free", source: "test" },
	aspect: "test",
	seed: { id: "empty", version: "1", data: null },
	input: { kind: "message", text: "answer", origin: "user" },
	tools: ["shell", "read", "write"],
	evidence: ["reply", "events"],
	assertions: [],
	stop: { kind: "reply" },
	bounds: { milliseconds: 1000, turns: 2, tokens: 100 },
	execution: { kind: "agent", skill: "arbor" },
};
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "claude-native-"));
	const repository = join(directory, "repo");
	const source = join(directory, "skill");
	await mkdir(repository);
	await mkdir(source);
	await writeFile(
		join(source, "SKILL.md"),
		"---\nname: arbor\ndescription: free fixture\n---\nNative skill bytes\n",
	);
	await mkdir(join(source, "references"));
	await writeFile(join(source, "references", "test.md"), "reference bytes");
	request = {
		model: "claude-sonnet-4-6",
		allowance,
		skill: { source, mode: "discovery" },
		tools: probe.tools,
		context: {
			probe: structuredClone(probe),
			isolation: {
				repository,
				arborHome: directory,
				logs: directory,
				outputs: directory,
				ports: [],
			},
			env: { HOME: join(directory, "home"), PATH: process.env.PATH ?? "" },
			signal: new AbortController().signal,
			evidence: { events: [], state: {}, complete: [], termination: "stop" },
			usage: { milliseconds: 0, turns: 0, tokens: null, costUsd: null },
			runtime: {},
			emit(event) {
				request.context.evidence.events.push(event);
			},
			reply(text) {
				request.context.evidence.reply = text;
			},
			trace() {},
			cleanup(dispose) {
				cleanups.push(dispose);
			},
			listen() {
				throw new Error("unused");
			},
		},
	};
});
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
	await rm(directory, { recursive: true, force: true });
});
async function success() {
	return readFile(
		join(import.meta.dir, "fixtures/native-claude/success.jsonl"),
		"utf8",
	);
}
function fixture(output: string, opts: FixtureOptions = {}) {
	const calls: Parameters<ClaudeLaunch>[0][] = [];
	let cancelled = 0,
		completed = 0;
	const launch: ClaudeLaunch = (call) => {
		calls.push(call);
		let finish: (code: number) => void = () => {};
		let stopped = false;
		const promise = new Promise<number>((resolve) => {
			finish = resolve;
		});
		queueMicrotask(() => {
			const preflight = call.argv[1] === "--help" || call.argv[1] === "auth";
			const text =
				call.argv[1] === "--help"
					? (opts.help ?? help)
					: call.argv[1] === "auth"
						? JSON.stringify({ loggedIn: opts.auth ?? true })
						: output;
			// Frames must parse independently of the transport chunk boundaries.
			for (let index = 0; index < text.length; index += 13) {
				call.stdout(text.slice(index, index + 13));
			}
			if (preflight || !opts.hold || stopped) {
				finish(preflight ? 0 : (opts.code ?? 0));
			}
		});
		return {
			completed: promise.then((code) => {
				completed++;
				return code;
			}),
			cancel() {
				if (!stopped) {
					stopped = true;
					cancelled++;
					finish(137);
				}
			},
		};
	};
	return {
		launch,
		calls,
		get cancelled() {
			return cancelled;
		},
		get completed() {
			return completed;
		},
	};
}

interface FixtureOptions {
	auth?: boolean;
	help?: string;
	code?: number;
	hold?: boolean;
}

it("rejects an observed model fallback instead of accepting its reply", async () => {
	const transport = fixture(
		(await success()).replaceAll("claude-sonnet-4-6", "claude-opus-4-7"),
	);
	const session = claudeDriver({ allowance, launch: transport.launch }).create(
		request,
	);
	await expect(session.run(() => {})).rejects.toThrow(
		"did not select requested model",
	);
	await session.dispose();
});

// scry-ignore simple-test-setup: this test alone creates a descendant that inherits stdout to expose close-before-exit cleanup deadlocks.
it("awaits a real process group when a descendant holds stdout open after its parent exits", async () => {
	const executable = join(directory, "fake-descendant");
	const pidFile = join(directory, "descendant.pid");
	await writeFile(
		executable,
		`#!/usr/bin/env bun
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
if (args[0] === '--help') console.log(${JSON.stringify(help)});
else if (args[0] === 'auth') console.log('{"loggedIn":true}');
else {
  await Bun.stdin.text();
  const child = spawn('/bin/sleep', ['30'], { stdio: 'inherit' });
  await Bun.write(${JSON.stringify(pidFile)}, String(child.pid));
  console.log(${JSON.stringify(await success())});
  process.exit(0);
}
`,
	);
	await chmod(executable, 0o755);
	const session = claudeDriver({ allowance, executable }).create(request);
	await session.run(() => {});
	await session.dispose();
	const pid = Number(await readFile(pidFile, "utf8"));
	expect(() => process.kill(pid, 0)).toThrow();
});
