import { dirname, join } from "node:path";
import { fail } from "@stringsync/splates-server/exit";
import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { ROOT } from "./root";

/** Opens the main checkout's server in a persistent tmux session for SSH access. */
export async function up({ ps, log }: { ps: Ps; log: Logger }): Promise<void> {
	const available = await ps.spawnCapture(["tmux", "-V"]).catch(() => null);
	if (available === null || available.exitCode !== 0) {
		fail(
			"usage",
			"tmux is required: install it with `brew install tmux`, then run `bin/splates dev up` again",
		);
	}
	const common = await ps.spawnCapture(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		{ cwd: ROOT },
	);
	if (common.exitCode !== 0 || common.stdout.trim() === "") {
		fail("usage", "could not find this repository's main checkout");
	}
	const root = dirname(common.stdout.trim());
	const nested = ps.env("TMUX") !== undefined;
	if (nested) {
		const session = await ps.spawnCapture([
			"tmux",
			"has-session",
			"-t",
			"=splates",
		]);
		if (session.exitCode === 0) {
			const switched = await ps.spawn([
				"tmux",
				"switch-client",
				"-t",
				"=splates",
			]);
			ps.exit(switched.exitCode);
			return;
		}
	}
	log.info(
		"Opening the splates tmux session. Detach with Ctrl+B, then D; reconnect with bin/splates dev up. A reboot ends the session.",
	);
	const started = await ps.spawn([
		"tmux",
		"new-session",
		nested ? "-d" : "-A",
		"-s",
		"splates",
		"-c",
		root,
		join(root, "bin/splates"),
		"server",
		"--keepalive",
	]);
	if (started.exitCode !== 0) {
		ps.exit(started.exitCode);
		return;
	}
	if (nested) {
		const switched = await ps.spawn([
			"tmux",
			"switch-client",
			"-t",
			"=splates",
		]);
		ps.exit(switched.exitCode);
	}
}
