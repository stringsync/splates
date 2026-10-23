import { dlopen, FFIType, ptr } from "bun:ffi";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { threadId } from "node:worker_threads";
import { NodePs, type Ps } from "webappwiz/system";
import type { GitRunner } from "./git";

let resolvedGit: string | undefined;

/** The git command to run, resolved once and cached. */
export function gitBinary(): string {
	// On macOS `/usr/bin/git` is a stub that asks `xcrun` for Xcode's git on
	// every call (~15ms), so when it is the git on PATH, run the real one;
	// any other git on PATH (Homebrew's) is left to PATH.
	if (resolvedGit !== undefined) {
		return resolvedGit;
	}
	resolvedGit = "git";
	if (process.platform === "darwin" && Bun.which("git") === "/usr/bin/git") {
		try {
			const found = Bun.spawnSync(["xcrun", "--find", "git"], {
				stdout: "pipe",
				stderr: "ignore",
			});
			const path = found.stdout.toString().trim();
			if (found.exitCode === 0 && path !== "" && path !== "/usr/bin/git") {
				resolvedGit = path;
			}
		} catch {
			// no xcrun: keep the stub
		}
	}
	return resolvedGit;
}

/** `GitRunner` as a process through `ps`. */
export function processGit(ps: Pick<Ps, "start">): GitRunner {
	// A real `NodePs` under Bun gets Bun's own spawn, which survives a lost
	// exit; a fake's `start` is what a test answers git with, so that stays.
	if (ps instanceof NodePs && typeof Bun !== "undefined") {
		return nativeGit();
	}
	return {
		git: async (cwd, args, env) => {
			// TODO: webappwiz/system once spawnCapture waits for both output pipes
			// to close: its exit fallback can resolve before their data arrives.
			const child = ps.start(
				[gitBinary(), "-C", cwd, ...args],
				env === undefined ? undefined : { env },
			);
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				// Nothing is written to git, so closing stdin only says so. A git
				// that exits before the close lands rejects it with a premature
				// close, which is no failure of the command.
				child.stdin.close().catch(() => undefined),
			]);
			return { code: exitCode, stdout, stderr };
		},
	};
}

/**
 * `GitRunner` as a process Bun spawns itself: the runner for real git under
 * Bun, which answers even when Bun loses the process.
 */
export function nativeGit(): GitRunner {
	// On macOS, Bun now and then loses a child's exit: the process is a
	// zombie, `exited` never settles, `exitCode` stays null, and nothing more
	// comes from its pipes (oven-sh/bun#45365, #45527). A merge gate's
	// thousands of concurrent git calls hit it about once a run, each a test
	// timing out. So git writes to files, which are whole once the process is
	// dead whatever Bun saw of its pipes, and a `waitpid` poll reaps the child
	// when Bun does not.
	return {
		git: async (cwd, args, env) => {
			sequence += 1;
			// Bun test workers share a pid but have separate module counters.
			const stamp = `${process.pid}-${threadId}-${sequence}`;
			const outPath = join(tmpdir(), `splates-git-${stamp}.out`);
			const errPath = join(tmpdir(), `splates-git-${stamp}.err`);
			try {
				const child = Bun.spawn([gitBinary(), "-C", cwd, ...args], {
					env: env === undefined ? process.env : { ...process.env, ...env },
					stdin: "ignore",
					stdout: Bun.file(outPath),
					stderr: Bun.file(errPath),
				});
				const code = await exitOf(child);
				const [stdout, stderr] = await Promise.all([
					readFile(outPath, "utf8"),
					readFile(errPath, "utf8"),
				]);
				return { code, stdout, stderr };
			} finally {
				await Promise.all([
					rm(outPath, { force: true }),
					rm(errPath, { force: true }),
				]);
			}
		},
	};
}

let sequence = 0;

/** How often the poll asks the kernel whether a child Bun has not reported on is gone. */
const REAP_POLL_MS = 250;

/**
 * The child's exit code, from Bun or from `waitpid` when Bun's notice never
 * comes. Polling starts after a beat, so a child Bun reports on in time is
 * never reaped out from under it.
 */
async function exitOf(child: Bun.Subprocess): Promise<number> {
	let timer: ReturnType<typeof setInterval> | undefined;
	const polled = new Promise<number>((resolve) => {
		timer = setInterval(() => {
			if (child.exitCode !== null || child.signalCode !== null) {
				return;
			}
			const status = reap(child.pid);
			if (status !== null) {
				resolve(status);
			}
		}, REAP_POLL_MS);
	});
	try {
		return await Promise.race([child.exited, polled]);
	} finally {
		clearInterval(timer);
	}
}

const WNOHANG = 1;
let waitpid: ((pid: number) => number | null) | undefined;

/**
 * Reaps `pid` if it has exited, returning its shell-style exit code, or null
 * while it runs or once someone else reaped it.
 */
function reap(pid: number): number | null {
	if (waitpid === undefined) {
		const status = new Int32Array(1);
		const { symbols } = dlopen(
			process.platform === "darwin" ? "libc.dylib" : "libc.so.6",
			{
				waitpid: {
					args: [FFIType.i32, FFIType.ptr, FFIType.i32],
					returns: FFIType.i32,
				},
			},
		);
		waitpid = (each) => {
			if (symbols.waitpid(each, ptr(status), WNOHANG) !== each) {
				return null;
			}
			const raw = status[0] ?? 0;
			const signal = raw & 0x7f;
			return signal === 0 ? (raw >> 8) & 0xff : 128 + signal;
		};
	}
	return waitpid(pid);
}

/** Whether git reaches `url` over SSH, as a deploy key signs in. */
export function sshUrl(url: string | null): boolean {
	return (
		url !== null && (/^ssh:\/\//.test(url) || /^[\w.-]+@[\w.-]+:/.test(url))
	);
}
