import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Repo } from "./scenario";

const splates = join(import.meta.dir, "../../packages/splates/index.ts");

/** Where one run works: its repo, and the splates home and PATH its commands see. */
export interface Sandbox {
	repo: Repo;
	env: Record<string, string>;
	/** Removes it all. */
	remove(): Promise<void>;
}

/**
 * A fresh repo for one run, in a temp directory outside the person's home,
 * with `skill` installed where Claude and Codex look for project skills:
 * `seed` adds the scenario's files before the first commit, `change` its
 * uncommitted work after it. The agent keeps the person's own login, but its
 * splates commands reach neither their server nor their tasks. Call `remove`
 * when the run is graded.
 */
export async function sandbox(
	skill: string,
	seed?: (repo: Repo) => Promise<void>,
	change?: (repo: Repo) => Promise<void>,
	initialized = false,
): Promise<Sandbox> {
	// A private splates home whose only agent can never start, and this
	// checkout's `splates` first on PATH.
	const root = await mkdtemp(join(await realpath(tmpdir()), "splates-eval-"));
	const dir = join(root, "repo");
	const home = join(root, "splates-home");
	const bin = join(root, "bin");
	await Promise.all(
		[dir, home, bin].map((each) => mkdir(each, { recursive: true })),
	);
	await writeFile(
		join(bin, "splates"),
		`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(splates)} "$@"\n`,
		{ mode: 0o755 },
	);
	await writeFile(
		join(home, "agents.json"),
		JSON.stringify({
			format: 1,
			agents: [{ id: "none", name: "No agent", argv: ["false"], models: [] }],
		}),
	);
	const env = {
		...outside(process.env),
		PATH: `${bin}:${process.env.PATH ?? ""}`,
		SPLATES_HOME: home,
		GIT_CONFIG_NOSYSTEM: "1",
	};
	const repo = repoAt(dir, env);
	await repo.write(
		"splates.config.ts",
		'export default { preMerge: "true" };\n',
	);
	for (const at of [".claude/skills/splates", ".agents/skills/splates"]) {
		await cp(skill, join(dir, at), { recursive: true });
	}
	await repo.run(["git", "init", "-q", "-b", "main"]);
	await repo.run(["git", "config", "user.name", "Eval seed"]);
	await repo.run(["git", "config", "user.email", "eval@example.invalid"]);
	await seed?.(repo);
	await repo.run(["git", "add", "-A"]);
	await repo.run(["git", "commit", "-qm", "Seed the eval repository"]);
	if (initialized) {
		await repo.run(["splates", "init"]);
		// init installs the released skill; the run is of the one given.
		for (const at of [".claude/skills/splates", ".agents/skills/splates"]) {
			await rm(join(dir, at), { recursive: true, force: true });
			await cp(skill, join(dir, at), { recursive: true });
		}
		await repo.run(["git", "add", "-A"]);
		await repo.run(["git", "commit", "-qm", "Initialize splates"]);
	}
	await change?.(repo);
	return {
		repo,
		env,
		remove: () => rm(root, { recursive: true, force: true }),
	};
}

function repoAt(dir: string, env: Record<string, string>): Repo {
	return {
		dir,
		async write(path, text) {
			await mkdir(dirname(join(dir, path)), { recursive: true });
			await writeFile(join(dir, path), text);
		},
		async run(argv) {
			const child = Bun.spawn(argv, {
				cwd: dir,
				env,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			if (code !== 0) {
				throw new Error(`${argv.join(" ")} exited ${code}: ${stderr.trim()}`);
			}
			return stdout;
		},
	};
}

/**
 * The environment without what ties a process to the person's splates or to
 * the agent running this: their server, conversation and home, and the
 * markers that make a Claude inside a Claude refuse.
 */
function outside(env: NodeJS.ProcessEnv): Record<string, string> {
	return Object.fromEntries(
		Object.entries(env).filter(
			(entry): entry is [string, string] =>
				entry[1] !== undefined &&
				!entry[0].startsWith("SPLATES_") &&
				!entry[0].startsWith("ARBOR_") &&
				entry[0] !== "CLAUDECODE" &&
				entry[0] !== "CLAUDE_CODE_ENTRYPOINT",
		),
	);
}

function quote(text: string): string {
	return `'${text.replaceAll("'", "'\\''")}'`;
}
