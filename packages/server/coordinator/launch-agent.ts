import type { Fs, Ps } from "webappwiz/system";

/** The LaunchAgent that keeps this Mac's worker dialing the moved coordinator. */
export const WORKER_AGENT = "dev.splates.worker";

/**
 * Installs and loads a LaunchAgent that runs `splates worker run` against
 * `coordinator` while the user is logged in, started again whenever it
 * stops, reading the key `splates worker join --key-file` kept.
 */
export async function installWorkerAgent(
	opts: WorkerAgentOptions,
): Promise<string> {
	const { fs, ps, home } = opts;
	const path = `${home}/Library/LaunchAgents/${WORKER_AGENT}.plist`;
	await fs.mkdir(`${home}/Library/LaunchAgents`, { recursive: true });
	await fs.write(path, workerAgentPlist(opts));
	const uid = (await ps.spawnCapture(["id", "-u"])).stdout.trim();
	// Loading one already loaded fails: take the old one out first.
	await ps.spawnCapture(["launchctl", "bootout", `gui/${uid}`, path]);
	const loaded = await ps.spawnCapture([
		"launchctl",
		"bootstrap",
		`gui/${uid}`,
		path,
	]);
	if (loaded.exitCode !== 0) {
		throw new Error(
			`launchctl could not load ${path}: ${(loaded.stderr || loaded.stdout).trim()}`,
		);
	}
	return path;
}

/** The LaunchAgent's property list. */
export function workerAgentPlist(
	opts: Omit<WorkerAgentOptions, "fs" | "ps" | "home">,
): string {
	const args = [
		opts.bunx,
		`@stringsync/splates@${opts.version}`,
		"worker",
		"run",
		"--coordinator",
		opts.coordinator,
		"--key-file",
	];
	const bin = opts.bunx.slice(0, opts.bunx.lastIndexOf("/"));
	const log = `${opts.splatesHome}/worker.log`;
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		"<dict>",
		`\t<key>Label</key><string>${WORKER_AGENT}</string>`,
		"\t<key>ProgramArguments</key>",
		"\t<array>",
		...args.map((arg) => `\t\t<string>${xml(arg)}</string>`),
		"\t</array>",
		"\t<key>EnvironmentVariables</key>",
		"\t<dict>",
		`\t\t<key>PATH</key><string>${xml(`${bin}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`)}</string>`,
		"\t</dict>",
		"\t<key>RunAtLoad</key><true/>",
		"\t<key>KeepAlive</key><true/>",
		`\t<key>StandardOutPath</key><string>${xml(log)}</string>`,
		`\t<key>StandardErrorPath</key><string>${xml(log)}</string>`,
		"</dict>",
		"</plist>",
		"",
	].join("\n");
}

/** Where and what the worker's LaunchAgent runs. */
export interface WorkerAgentOptions {
	fs: Fs;
	ps: Ps;
	/** The user's home, whose `Library/LaunchAgents` it goes in. */
	home: string;
	/** splates's home, where the worker's log goes. */
	splatesHome: string;
	/** The coordinator's URL it dials. */
	coordinator: string;
	/** The splates release it runs, which updates itself after. */
	version: string;
	/** Where `bunx` is. */
	bunx: string;
}

function xml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
