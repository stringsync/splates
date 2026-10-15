import { isAbsolute, resolve } from "node:path";
import type { Deps } from "webappwiz/cmd";
import type { Fs } from "webappwiz/system";
import type { SecretStores } from "./creds";
import type { DevMachine } from "./dev-project";
import { fail } from "./exit";
import { init } from "./init";
import type { Project } from "./projects";
import { openRepository } from "./repository";

/**
 * What the page's project picker asks of `arbor dev` beyond listing: adding
 * a project, committing what `arbor init` wrote there, and focusing one. Its
 * handlers are properties, so `dev` hands them to its routes as they are.
 */
export class Picker {
	constructor(private readonly deps: DevMachine) {}

	/**
	 * Adds the repository the body's `path` names, as `arbor init` there
	 * would, and focuses it.
	 */
	readonly add = async (request: Request): Promise<Response> => {
		const { path } = (await request.json().catch(() => ({}))) as {
			path?: unknown;
		};
		if (typeof path !== "string" || path.trim() === "") {
			fail("usage", "name the project's path", {});
		}
		return Response.json(await initProject(this.deps, path));
	};

	/** Commits the body's `paths`, which `arbor init` wrote, once the person said to. */
	readonly commit = async (request: Request): Promise<Response> => {
		const slug = new URL(request.url).pathname.split("/")[3] ?? "";
		const { paths } = (await request.json().catch(() => ({}))) as {
			paths?: unknown;
		};
		const found = (await this.deps.projects.list()).find(
			(each) => each.slug === slug,
		);
		if (found === undefined || found.gone) {
			fail("not_found", `no arbor project '${slug}'`, { project: slug });
		}
		await commitInit(
			this.deps,
			found.root,
			Array.isArray(paths) ? paths.map(String) : [],
		);
		return Response.json({});
	};

	/** Makes the body's `project` what an address naming none shows, on any device. */
	readonly focus = async (request: Request): Promise<Response> => {
		const { project } = (await request.json().catch(() => ({}))) as {
			project?: unknown;
		};
		const { projects } = this.deps;
		const found = (await projects.list()).find((each) => each.slug === project);
		if (found === undefined) {
			fail("not_found", `no arbor project '${String(project)}'`, {
				project,
			});
		}
		await projects.focus(found.root);
		return Response.json({});
	};
}

/**
 * What `arbor init` writes in a project: the skill, its link for Claude
 * Code, and the lock `skills` keeps. Uncommitted, each is offered again,
 * even when an earlier init left it so.
 */
export const INIT_WRITES = [
	".agents/skills/arbor",
	".claude/skills/arbor",
	"skills-lock.json",
];

/** A project the page added, and what `arbor init` left in it to commit. */
export interface Added {
	project: Project;
	/**
	 * Each file init wrote that is not committed, as `git status` names it:
	 * what the page asks to commit, and all it commits.
	 */
	uncommitted: string[];
	/** The same, each under one of `INIT_WRITES` named by that, for the page to say. */
	shown: string[];
	/** The branch a commit of them lands on; null on a detached HEAD. */
	branch: string | null;
}

/**
 * Makes the repository `path` sits in an arbor project, as `arbor init` run
 * there would, `~` meaning the home directory: its records, made or brought
 * forward, the skill, and its place in the registry, focused. Commits
 * nothing, but says what init wrote, for the page to ask before it commits.
 */
export async function initProject(
	machine: Deps & { fs: Fs; secrets?: SecretStores },
	path: string,
): Promise<Added> {
	const { fs, ps, log } = machine;
	const home = ps.env("HOME") ?? "";
	const typed = path.trim().replace(/^~(?=\/|$)/, home);
	if (!isAbsolute(typed)) {
		fail("usage", `give the project's full path, or one from ~: not ${path}`, {
			path,
		});
	}
	const at = resolve(typed);
	if (!(await fs.exists(at))) {
		fail("not_found", `${at} does not exist`, { path: at });
	}
	const repository = await openRepository(machine, {
		at,
		creates: true,
		migrates: true,
	}).catch((error: unknown) => {
		if (error instanceof Error && error.message.startsWith("not a git")) {
			fail("usage", `${at} is not in a git repository: git init it first`, {
				path: at,
			});
		}
		throw error;
	});
	const { git, projects } = repository;
	const before = await changed(machine, git.root);
	await init({ git, projects, fs, ps, log });
	await projects.focus(git.root);
	const project = (await projects.list()).find(
		(each) => each.root === git.root,
	);
	if (project === undefined) {
		throw new Error(`${git.root} was registered, yet the registry lacks it`);
	}
	const after = await changed(machine, git.root);
	const uncommitted = [...after.entries()]
		.filter(
			([file, status]) =>
				before.get(file) !== status || writtenBy(file) !== null,
		)
		.map(([file]) => file)
		.sort();
	return {
		project,
		uncommitted,
		shown: [...new Set(uncommitted.map((file) => writtenBy(file) ?? file))],
		branch: await git.currentBranch(git.root),
	};
}

/**
 * Commits `paths` in the main tree at `root` as setting up arbor, on
 * whatever it has checked out, leaving every other change as it was.
 */
export async function commitInit(
	{ ps }: Deps,
	root: string,
	paths: string[],
): Promise<void> {
	if (paths.length === 0) {
		fail("usage", "name the paths to commit", {});
	}
	for (const argv of [
		["add", "--", ...paths],
		["commit", "--quiet", "--message", "Set up arbor", "--", ...paths],
	]) {
		const { exitCode, stdout, stderr } = await ps.spawnCapture([
			"git",
			"-C",
			root,
			...argv,
		]);
		if (exitCode !== 0) {
			fail(
				"usage",
				`git ${argv[0]} failed in ${root}: ${(stderr || stdout).trim()}`,
				{ root, paths },
			);
		}
	}
}

/** Which of `INIT_WRITES` holds `file`, or null for none. */
function writtenBy(file: string): string | null {
	return (
		INIT_WRITES.find((path) => file === path || file.startsWith(`${path}/`)) ??
		null
	);
}

/**
 * Each file `git status` names in `root`, with its two-letter status, every
 * untracked one by itself, so none rides along in a directory it shares.
 */
async function changed(
	{ ps }: Deps,
	root: string,
): Promise<Map<string, string>> {
	// Read raw, since a trimmed first line loses its status's leading space.
	const { exitCode, stdout, stderr } = await ps.spawnCapture([
		"git",
		"-C",
		root,
		"status",
		"--porcelain",
		"--untracked-files=all",
		"-z",
	]);
	if (exitCode !== 0) {
		throw new Error(`git status in ${root}: ${stderr.trim()}`);
	}
	const found = new Map<string, string>();
	const entries = stdout.split("\0");
	for (let at = 0; at < entries.length; at++) {
		const entry = entries[at] ?? "";
		if (entry.length < 4) {
			continue;
		}
		const status = entry.slice(0, 2);
		found.set(entry.slice(3), status);
		// A rename or copy names where it came from next.
		if (/[RC]/.test(status)) {
			at++;
		}
	}
	return found;
}
