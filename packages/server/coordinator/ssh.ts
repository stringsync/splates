import type { Ps } from "webappwiz/system";
import { shellQuoted } from "./scripts";

/**
 * A root shell on the coordinator's box over SSH, signed in with the key
 * `splates server deploy` made, trusting the box's host key the first time
 * it is seen and holding it to that key after, in a file of splates's own.
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
		if (ran.exitCode !== 0) {
			throw new Error(
				`the box's shell failed (${ran.exitCode}): ${(ran.stderr || ran.stdout).trim()}`,
			);
		}
		return ran.stdout;
	}

	/** Copies the file at `local` to `remote` on the box. */
	async copy(local: string, remote: string): Promise<void> {
		const ran = await this.opts.ps.spawnCapture([
			...this.ssh("scp"),
			"-q",
			local,
			`root@${this.opts.ipv4}:${remote}`,
		]);
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
			"StrictHostKeyChecking=accept-new",
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
	/** Where the box's host key is kept once seen. */
	knownHosts: string;
}
