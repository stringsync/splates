import { homedir } from "node:os";
import type { Fs } from "webappwiz/system";

/** Set on an agent process that must write only in its scratch and agent state. */
export const SCRATCH = "SPLATES_SCRATCH";

/** Makes the directories a scratch agent may write, on the machine it will run on. */
export async function prepareScratch(
	fs: Fs,
	agent: string,
	cwd: string,
	home = homedir(),
): Promise<void> {
	await Promise.all(writable(agent, cwd, home).map((path) => fs.mkdir(path)));
}

/** `argv` sandboxed when `env` marks a scratch agent, unchanged otherwise. */
export function scratchLaunch(
	argv: string[],
	cwd: string,
	env: Record<string, string>,
	platform: string,
	home = homedir(),
): string[] {
	const agent = env[SCRATCH];
	if (agent === undefined) {
		return argv;
	}
	const paths = writable(agent, cwd, home);
	if (platform === "darwin") {
		return ["sandbox-exec", "-p", profile(paths), "--", ...argv];
	}
	if (platform === "linux") {
		return [
			"bwrap",
			"--die-with-parent",
			"--new-session",
			"--unshare-all",
			"--share-net",
			"--ro-bind",
			"/",
			"/",
			"--tmpfs",
			"/tmp",
			...paths.flatMap((path) => ["--bind", path, path]),
			"--chdir",
			cwd,
			"--",
			...argv,
		];
	}
	throw new Error(
		`scratch conversations need a filesystem sandbox: ${platform} is not supported`,
	);
}

function writable(agent: string, cwd: string, home: string): string[] {
	const state =
		agent === "claude"
			? [".claude", ".config/claude", ".cache/claude"]
			: agent === "codex"
				? [".codex"]
				: agent === "kimi"
					? [".kimi-code"]
					: agent === "opencode"
						? [".config/opencode", ".local/share/opencode", ".cache/opencode"]
						: [];
	return [
		cwd,
		...new Set(
			[".bun", ".npm", ".cache", ...state].map((path) => `${home}/${path}`),
		),
	];
}

function profile(paths: readonly string[]): string {
	return [
		"(version 1)",
		"(deny default)",
		"(allow process*)",
		"(allow signal (target same-sandbox))",
		"(allow network*)",
		"(allow mach-lookup)",
		"(allow sysctl-read)",
		"(allow ipc-posix-shm)",
		"(allow file-read*)",
		...["/dev/null", "/dev/tty", "/dev/random", "/dev/urandom"].map(
			(path) => `(allow file-write* (literal ${JSON.stringify(path)}))`,
		),
		...["/tmp", "/private/tmp", "/var/folders"].map(
			(path) => `(allow file-write* (subpath ${JSON.stringify(path)}))`,
		),
		...paths.map(
			(path) => `(allow file-write* (subpath ${JSON.stringify(path)}))`,
		),
	].join("\n");
}
