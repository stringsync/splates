import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Event } from "./probe";
import { launchIsolated } from "./probe-adapters";
import type { RunContext } from "./runner";

const arbor = join(import.meta.dir, "../../packages/arbor/index.ts");

/** Minimal local CLI repository; no lanes, tasks, model setup or legacy fixture. */
export async function seedRepository(context: RunContext): Promise<void> {
	const bin = join(context.isolation.outputs, "bin");
	await mkdir(bin, { recursive: true });
	await writeFile(
		join(bin, "arbor"),
		`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(arbor)} "$@"\n`,
		{ mode: 0o755 },
	);
	context.env.PATH = `${bin}:${context.env.PATH}`;
	context.env.GIT_CONFIG_NOSYSTEM = "1";
	context.env.GIT_CONFIG_GLOBAL = "/dev/null";
	// Seeding and real CLI probes cannot accidentally hand off to a paid agent.
	await writeFile(
		join(context.isolation.arborHome, "agents.json"),
		JSON.stringify({
			format: 1,
			agents: [
				{
					id: "fake",
					name: "Disabled eval boundary",
					argv: ["false"],
					models: [],
				},
			],
		}),
	);
	await writeFile(
		join(context.isolation.repository, "arbor.config.ts"),
		'export default { preMerge: "true" };\n',
	);
	for (const argv of [
		["git", "init", "-q", "-b", "main"],
		["git", "config", "user.name", "Probe fixture"],
		["git", "config", "user.email", "probe@example.invalid"],
		["git", "add", "."],
		["git", "commit", "-qm", "Seed minimal probe repository"],
	]) {
		const result = await command(context, argv, "fixture");
		if (result.exitCode !== 0) {
			throw new Error(
				`fixture command failed: ${JSON.stringify(argv)}: ${result.stderr}`,
			);
		}
	}
}

/** Actual argv boundary, not a parser for proposed shell text. Nested activity stays incomplete. */
export async function command(
	context: RunContext,
	argv: string[],
	actor: Event["actor"] = "fixture",
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	context.signal.throwIfAborted();
	const child = launchIsolated(context)(
		argv,
		context.isolation.repository,
		context.env,
	);
	await child.input.close();
	let stdout = "";
	const reading = (async () => {
		const decoder = new TextDecoder();
		for await (const frame of child.output) {
			stdout += decoder.decode(frame.bytes, { stream: true });
		}
	})();
	const exitCode = await child.exited;
	await reading;
	const result = { stdout, stderr: child.stderr(), exitCode };
	const normalized = normalizeCommand(argv);
	context.emit({
		id: `command-${context.evidence.events.length + 1}`,
		actor,
		kind: "command",
		...normalized,
		exitCode,
		payload: { stdout, stderr: result.stderr },
	});
	return result;
}

export function normalizeCommand(argv: string[]): {
	name: string;
	args: string[];
} {
	if (argv[0] === "bunx" && argv[1] === "@webappwiz/arbor") {
		return { name: "arbor", args: argv.slice(2) };
	}
	if (
		argv[0] === "arbor" ||
		argv[0]?.endsWith("/arbor") ||
		argv[0]?.endsWith("/bin/arbor")
	) {
		return { name: "arbor", args: argv.slice(1) };
	}
	if (argv[0] === process.execPath && argv[1] === arbor) {
		return { name: "arbor", args: argv.slice(2) };
	}
	return { name: argv[0] ?? "", args: argv.slice(1) };
}

/** Write an explicitly relative fixture file, refusing to seed outside its repository. */
export async function seedFile(
	context: RunContext,
	path: string,
	text: string,
): Promise<void> {
	if (path.startsWith("/") || path.split(/[\\/]/).includes("..")) {
		throw new Error(`fixture path must stay in repository: ${path}`);
	}
	context.signal.throwIfAborted();
	const file = join(context.isolation.repository, path);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, text);
}
function quote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
