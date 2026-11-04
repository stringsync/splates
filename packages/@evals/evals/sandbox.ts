import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import type { Repo, Scenario } from "./scenario";

/** Makes the sandbox of one run of `scenario` with the skill at `skill`. */
export type MakeSandbox = (
	skill: string,
	scenario: Scenario,
) => Promise<Sandbox>;

/** Where one run works: its repo, and the environment its commands see. */
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
 * uncommitted work after it. The agent keeps the person's own login. Call `remove`
 * when the run is graded.
 */
export async function sandbox(
	skill: string,
	seed?: (repo: Repo) => Promise<void>,
	change?: (repo: Repo) => Promise<void>,
): Promise<Sandbox> {
	const root = await mkdtemp(join(await realpath(tmpdir()), "eval-"));
	const dir = join(root, "repo");
	await mkdir(dir, { recursive: true });
	const name = basename(skill);
	const installs = [`.claude/skills/${name}`, `.agents/skills/${name}`];
	const env = {
		...outside(process.env),
		// opencode takes its project from PWD, not the cwd it is spawned in.
		PWD: dir,
		GIT_CONFIG_NOSYSTEM: "1",
		// An inherited Playwright MCP denies screenshots written outside its
		// output directory; the run's own directory is where they belong, and
		// the agent already runs with no sandbox of its own.
		PLAYWRIGHT_MCP_OUTPUT_DIR: join(root, "playwright"),
		PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS: "true",
	};
	const repo = repoAt(dir, env);
	for (const at of installs) {
		await cp(skill, join(dir, at), {
			recursive: true,
			filter: (source) => relative(skill, source).split(/[\\/]/)[0] !== "evals",
		});
	}
	await repo.run(["git", "init", "-q", "-b", "main"]);
	await repo.run(["git", "config", "user.name", "Eval seed"]);
	await repo.run(["git", "config", "user.email", "eval@example.invalid"]);
	await seed?.(repo);
	await repo.run(["git", "add", "-A"]);
	await repo.run(["git", "commit", "-qm", "Seed the eval repository"]);
	await change?.(repo);
	return {
		repo,
		env,
		remove: () => rm(root, { recursive: true, force: true }),
	};
}

/** A `Repo` over the directory `dir`, whose commands run with `env`. */
export function repoAt(dir: string, env: Record<string, string>): Repo {
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
 * The environment without what ties a process to the agent running this: the
 * markers that make a Claude inside a Claude refuse.
 */
export function outside(env: NodeJS.ProcessEnv): Record<string, string> {
	return Object.fromEntries(
		Object.entries(env).filter(
			(entry): entry is [string, string] =>
				entry[1] !== undefined &&
				entry[0] !== "CLAUDECODE" &&
				entry[0] !== "CLAUDE_CODE_ENTRYPOINT",
		),
	);
}
