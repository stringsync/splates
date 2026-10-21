import type { Ps } from "webappwiz/system";
import { shellQuoted } from "./scripts";

/**
 * A root shell on the coordinator's box over SSH, signed in with the key
 * `splates server deploy` made, holding the box to the host key `CoordinatorBox`
 * recorded for it in a file of splates's own, and refusing any other.
 */
export class BoxShell {
	constructor(private readonly opts: BoxShellOptions) {}

	/** Runs `script` in `sh` on the box, with `stdin`, when given, on its stdin, answering what it printed. */
	async run(script: string, stdin?: string): Promise<string> {
		// With stdin of its own, the script cannot come on stdin: it goes
		// as the remote command, which the box's shell reads whole.
		const remote =
			stdin === undefined ? ["sh", "-s"] : ["sh", "-c", shellQuoted(script)];
		const ran = await this.opts.ps.spawnCapture(
			[...this.ssh("ssh"), `root@${this.opts.ipv4}`, ...remote],
			{ stdin: stdin ?? script },
		);
		this.refuseChangedKey(ran.stderr);
		if (ran.exitCode !== 0) {
			throw new Error(
				`the box's shell failed (${ran.exitCode}): ${(ran.stderr || ran.stdout).trim()}`,
			);
		}
		return ran.stdout;
	}

	private refuseChangedKey(stderr: string): void {
		if (
			/host key verification failed|host key for .* has changed/i.test(stderr)
		) {
			throw new Error(
				`not connecting: the box at ${this.opts.ipv4} does not hold the host key splates gave it (${this.opts.knownHosts}), so something else may be answering at that address`,
			);
		}
	}

	/** Copies the file at `local` to `remote` on the box. */
	async copy(local: string, remote: string): Promise<void> {
		const ran = await this.opts.ps.spawnCapture([
			...this.ssh("scp"),
			"-q",
			local,
			`root@${this.opts.ipv4}:${remote}`,
		]);
		this.refuseChangedKey(ran.stderr);
		if (ran.exitCode !== 0) {
			throw new Error(
				`could not copy ${local} to the box: ${(ran.stderr || ran.stdout).trim()}`,
			);
		}
	}

	/** The `ssh` that logs in to the box as root, running `command` there, or a shell for none. */
	login(command: string[] = []): string[] {
		return [
			...this.ssh("ssh"),
			...(command.length === 0 ? ["-t"] : []),
			`root@${this.opts.ipv4}`,
			...command,
		];
	}

	private ssh(command: "ssh" | "scp"): string[] {
		return [
			command,
			"-i",
			this.opts.key,
			"-o",
			"BatchMode=yes",
			"-o",
			"IdentitiesOnly=yes",
			"-o",
			"StrictHostKeyChecking=yes",
			"-o",
			`UserKnownHostsFile=${this.opts.knownHosts}`,
			"-o",
			"ConnectTimeout=15",
		];
	}
}

/** Which box a `BoxShell` reaches, and how. */
export interface BoxShellOptions {
	ps: Ps;
	ipv4: string;
	/** The private key that logs in as root. */
	key: string;
	/** Where the box's host key is kept, written before the first connection. */
	knownHosts: string;
}
