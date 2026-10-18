import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { sep } from "node:path";
import type { Fs, Ps } from "webappwiz/system";
import { splatesHome } from "../models";

/**
 * What an agent writes in its home, kept across its runs: its login,
 * settings and sessions, which `session/load` resumes, and bun's cache,
 * which `bunx` starts each agent CLI from. Everything else of the home it
 * sees read-only.
 */
const AGENT_STATE = [".claude", ".codex", ".cache", ".bun/install/cache"];

/** Files of an agent's state in the home itself, bound only where they exist. */
const AGENT_STATE_FILES = [".claude.json"];

/** What of the home no agent may see, where it exists: keys an SSH client signs in with. */
const HIDDEN = [".ssh"];

/** The homes a sandbox is built against, by their canonical paths. */
export interface SandboxHomes {
	/** The user's home. */
	home: string;
	/** splates's home on this worker, which holds its key file and every project's clone. */
	splates: string;
	/** What of `HIDDEN` the home holds, which alone bubblewrap can cover. */
	hidden: string[];
}

/**
 * Keeps each agent a Linux worker runs from the others: `probe` once at
 * start, then `wrap` each agent's argv. Inside, it cannot read a sibling's
 * placeholder key from `/proc/<pid>/environ`, sees the system read-only
 * and splates's home only as far as its own project, and still reaches
 * the loopback credential proxy, the relay and the shared browser.
 */
export class AgentSandbox {
	// bubblewrap, in a process namespace of its own on the worker's network:
	// its processes stay the worker's descendants, which `WorkerProcessHost`
	// ends with it and the coordinator finds with `ps` and `ss`.
	private constructor(private readonly homes: SandboxHomes) {}

	/**
	 * The sandbox this machine can run, or why it cannot: it runs a command
	 * in one as it would an agent, so a kernel or container that refuses a
	 * namespace or a `/proc` mount is found once, at start.
	 */
	static async probe(ps: Ps, fs: Fs): Promise<AgentSandbox | string> {
		if (ps.platform !== "linux") {
			return `agents run sandboxed only on Linux, not ${ps.platform}`;
		}
		// Made first, since bubblewrap hides only what exists.
		await fs.mkdir(splatesHome(ps));
		const home = await realpath(ps.env("HOME") ?? homedir());
		const hidden: string[] = [];
		for (const each of HIDDEN) {
			if (await fs.exists(`${home}/${each}`)) {
				hidden.push(each);
			}
		}
		const homes: SandboxHomes = {
			home,
			splates: await realpath(splatesHome(ps)).catch(() => splatesHome(ps)),
			hidden,
		};
		for (const each of AGENT_STATE) {
			await fs.mkdir(`${homes.home}/${each}`).catch(() => {});
		}
		const ran = await ps
			.spawnCapture(sandboxArgv(homes, ["true"], homes.home), {
				timeoutMs: 10_000,
			})
			.catch((error: unknown) => ({
				exitCode: 127,
				stdout: "",
				stderr: error instanceof Error ? error.message : String(error),
			}));
		if (ran.exitCode !== 0) {
			const why = (ran.stderr || ran.stdout).trim().split("\n")[0];
			return ran.exitCode === 127 && !why?.startsWith("bwrap")
				? "bubblewrap (bwrap) is not installed"
				: `bubblewrap cannot run here: ${why}`;
		}
		return new AgentSandbox(homes);
	}

	/** `argv`, to run in `cwd` inside a sandbox of its own. */
	wrap(argv: string[], cwd: string): string[] {
		return sandboxArgv(this.homes, argv, cwd);
	}
}

/**
 * The bubblewrap command that runs `argv` in `cwd`: the system and the home
 * read-only, `/tmp` its own, splates's home and SSH keys hidden, and
 * writable only its agent's state and the project `cwd` is in, its
 * clone and every task's beside it, with the mirror they borrow objects
 * from read-only. A `cwd` outside splates's projects is writable alone.
 */
export function sandboxArgv(
	{ home, splates, hidden }: SandboxHomes,
	argv: string[],
	cwd: string,
): string[] {
	const out = [
		"bwrap",
		"--die-with-parent",
		"--unshare-user",
		"--unshare-pid",
		"--unshare-ipc",
		"--ro-bind",
		"/",
		"/",
		"--dev",
		"/dev",
		"--proc",
		"/proc",
		"--tmpfs",
		"/tmp",
		"--tmpfs",
		splates,
	];
	for (const each of hidden) {
		out.push("--tmpfs", `${home}/${each}`);
	}
	for (const each of [...AGENT_STATE, ...AGENT_STATE_FILES]) {
		out.push("--bind-try", `${home}/${each}`, `${home}/${each}`);
	}
	const project = projectOf(splates, cwd);
	if (project === null) {
		out.push("--bind", cwd, cwd);
	} else {
		const mirror = `${splates}/worker/mirrors/${project.name}.git`;
		out.push("--ro-bind-try", mirror, mirror);
		out.push("--bind", project.dir, project.dir);
	}
	out.push("--chdir", cwd, "--", ...argv);
	return out;
}

/** The project `cwd` is in, among splates's projects on this worker: its name and directory. */
function projectOf(
	splates: string,
	cwd: string,
): { name: string; dir: string } | null {
	const projects = `${splates}/worker/projects${sep}`;
	if (!cwd.startsWith(projects)) {
		return null;
	}
	const name = cwd.slice(projects.length).split(sep)[0] ?? "";
	if (name === "" || name === "." || name === "..") {
		return null;
	}
	return { name, dir: `${projects}${name}` };
}
