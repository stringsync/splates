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
import type { SecretStore } from "webappwiz/creds";
import type { Child, Ps } from "webappwiz/system";
import { directRepo, shellQuoted } from "./direct-script";
import { SNAPSHOT_USER } from "./snapshot";

/** A runner `splates run` made, as it reaches it. */
export interface RunnerHost {
	/** Its name, which its tag carries, and which the budget counts it by. */
	id: string;
	/** Its public IPv4 address. */
	address: string;
}

/** What `RunnerShell.capture` answers. */
export interface Captured {
	code: number;
	stdout: string;
	stderr: string;
}

/**
 * How `splates run` drives a runner it made: a script run in bash there, and
 * a commit pushed to a project's clone there. Over SSH for real; in a
 * directory here in tests.
 */
export interface RunnerShell {
	/** Runs `script` on `host`, answering what it printed. */
	capture(host: RunnerHost, script: string): Promise<Captured>;
	/** Starts `script` on `host`, its output streamed; closing its stdin hangs up. */
	start(host: RunnerHost, script: string): Child;
	/** Pushes `commit` of the repository at `cwd` to `ref` of `project`'s clone on `host`. */
	push(
		host: RunnerHost,
		cwd: string,
		commit: string,
		project: string,
		ref: string,
	): Promise<void>;
}

/** The device cred the private half of the key `splates run` logs in to its runners with is kept as. */
export const RUNNER_SSH_KEY = "SPLATES_RUNNER_SSH_KEY";

/** The public half's cred, which each runner made is given. */
export const RUNNER_SSH_PUBLIC_KEY = "SPLATES_RUNNER_SSH_PUBLIC_KEY";

/** The key `splates run` logs in to its runners with: made once, kept in the device's creds. */
export interface RunnerKey {
	privateKey: string;
	publicKey: string;
}

/**
 * The runner key the device's creds keep, made with `ssh-keygen` on first
 * use. Only the public half goes to a runner, in its user data.
 */
export async function runnerKey(
	store: SecretStore,
	ps: Ps,
): Promise<RunnerKey> {
	const privateKey = await store.get(RUNNER_SSH_KEY);
	const publicKey = await store.get(RUNNER_SSH_PUBLIC_KEY);
	if (privateKey !== undefined && publicKey !== undefined) {
		return { privateKey, publicKey };
	}
	const dir = await mkdtemp(join(tmpdir(), "splates-key-"));
	try {
		const file = join(dir, "key");
		const made = await ps.spawnCapture([
			"ssh-keygen",
			"-q",
			"-t",
			"ed25519",
			"-N",
			"",
			"-C",
			"splates-runner",
			"-f",
			file,
		]);
		if (made.exitCode !== 0) {
			throw new Error(
				`ssh-keygen could not make the runner key: ${made.stderr.trim()}`,
			);
		}
		const key = {
			privateKey: await readFile(file, "utf8"),
			publicKey: (await readFile(`${file}.pub`, "utf8")).trim(),
		};
		await store.set(RUNNER_SSH_KEY, key.privateKey);
		await store.set(RUNNER_SSH_PUBLIC_KEY, key.publicKey);
		return key;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/**
 * Reaches runners over `ssh` as `SNAPSHOT_USER`, with the runner key written
 * to a file only this user reads for as long as it is open. Each runner's
 * host key is trusted on first use and kept by its id, since a cloud hands
 * a deleted machine's address to the next.
 */
export class SshShell implements RunnerShell, AsyncDisposable {
	private constructor(
		private readonly ps: Ps,
		private readonly dir: string,
		private readonly hosts: string,
	) {}

	/** Opens a shell with `key`, keeping host keys under `home`. */
	static async open(ps: Ps, key: RunnerKey, home: string): Promise<SshShell> {
		const dir = await mkdtemp(join(tmpdir(), "splates-ssh-"));
		await chmod(dir, 0o700);
		await writeFile(join(dir, "key"), key.privateKey, { mode: 0o600 });
		const hosts = join(home, "direct-runners", "hosts");
		await mkdir(hosts, { recursive: true });
		return new SshShell(ps, dir, hosts);
	}

	async capture(host: RunnerHost, script: string): Promise<Captured> {
		const { exitCode, stdout, stderr } = await this.ps.spawnCapture(
			this.argv(host, script),
		);
		return { code: exitCode, stdout, stderr };
	}

	start(host: RunnerHost, script: string): Child {
		return this.ps.start(this.argv(host, script));
	}

	async push(
		host: RunnerHost,
		cwd: string,
		commit: string,
		project: string,
		ref: string,
	): Promise<void> {
		const pushed = await this.ps.spawnCapture(
			[
				"git",
				"-C",
				cwd,
				"push",
				"--quiet",
				"--force",
				`${SNAPSHOT_USER}@${host.address}:${directRepo(project)}`,
				`${commit}:${ref}`,
			],
			{
				env: {
					GIT_SSH_COMMAND: this.options(host).map(shellQuoted).join(" "),
				},
			},
		);
		if (pushed.exitCode !== 0) {
			throw new Error(
				`could not send the job to runner ${host.id}: ${pushed.stderr.trim()}`,
			);
		}
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await rm(this.dir, { recursive: true, force: true });
	}

	private argv(host: RunnerHost, script: string): string[] {
		return [
			...this.options(host),
			`${SNAPSHOT_USER}@${host.address}`,
			`bash -c ${shellQuoted(script)}`,
		];
	}

	private options(host: RunnerHost): string[] {
		return [
			"ssh",
			"-i",
			join(this.dir, "key"),
			"-o",
			"IdentitiesOnly=yes",
			"-o",
			"BatchMode=yes",
			"-o",
			"StrictHostKeyChecking=accept-new",
			"-o",
			`UserKnownHostsFile=${join(this.hosts, host.id)}`,
			"-o",
			"ConnectTimeout=10",
			"-o",
			"ServerAliveInterval=15",
			"-o",
			"ServerAliveCountMax=4",
			"-o",
			"LogLevel=ERROR",
		];
	}
}
