import { basename } from "node:path";
import type { Ps } from "webappwiz/system";
import { shellQuoted } from "./scripts";

/** The user EC2 puts the stack's key pair on, in Ubuntu's images. */
const BOX_LOGIN = "ubuntu";

/**
 * A root shell on the coordinator's box over SSH, signed in as Ubuntu's
 * `ubuntu`, the one user EC2 gives the key its Pulumi stack made, and
 * raised to root through its passwordless `sudo`, holding the box to the host key `CoordinatorBox`
 * recorded for it in a file of splates's own, and refusing any other.
 */
export class BoxShell {
	constructor(private readonly opts: BoxShellOptions) {}

	/** Runs `script` in `sh` on the box, with `stdin`, when given, on its stdin, answering what it printed. */
	async run(script: string, stdin?: string): Promise<string> {
		// With stdin of its own, the script cannot come on stdin: it goes
		// as the remote command, which the box's shell reads whole.
		const remote =
			stdin === undefined
				? ["sudo", "sh", "-s"]
				: ["sudo", "sh", "-c", shellQuoted(script)];
		const ran = await this.opts.ps.spawnCapture(
			[...this.ssh("ssh"), this.target(), ...remote],
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

	/**
	 * Copies the file at `local` to `remote` on the box, by way of
	 * `ubuntu`'s home, since only root may write most of the box.
	 */
	async copy(local: string, remote: string): Promise<void> {
		const staged = `copy-${basename(remote)}`;
		const ran = await this.opts.ps.spawnCapture([
			...this.ssh("scp"),
			"-q",
			local,
			`${this.target()}:${staged}`,
		]);
		this.refuseChangedKey(ran.stderr);
		if (ran.exitCode !== 0) {
			throw new Error(
				`could not copy ${local} to the box: ${(ran.stderr || ran.stdout).trim()}`,
			);
		}
		await this.run(
			`mv "$(getent passwd ${BOX_LOGIN} | cut -d: -f6)"/${shellQuoted(staged)} ${shellQuoted(remote)}`,
		);
	}

	/** The `ssh` that logs in to the box as root, running `command` there, or a shell for none. */
	login(command: string[] = []): string[] {
		return [
			...this.ssh("ssh"),
			...(command.length === 0
				? ["-t", this.target(), "sudo", "-i"]
				: [this.target(), "sudo", ...command]),
		];
	}

	private target(): string {
		return `${BOX_LOGIN}@${this.opts.ipv4}`;
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
	/** The private key that logs in as `ubuntu`. */
	key: string;
	/** Where the box's host key is kept, written before the first connection. */
	knownHosts: string;
}
