import type { SecretStore } from "webappwiz/creds";
import type { Fs, Ps } from "webappwiz/system";

/**
 * Pulumi as splates drives it: its own CLI, from the Cloud workers setup,
 * against the file backend on this machine, one project directory per
 * program. A program is Pulumi YAML, written as JSON, which YAML reads.
 */
export class Pulumi {
	readonly paths: PulumiPaths;

	constructor(private readonly opts: PulumiOptions) {
		this.paths = pulumiPaths(opts.home);
	}

	/** Writes the program of project `name`, answering the directory it runs in. */
	async program(name: string, program: object): Promise<string> {
		const dir = `${this.paths.root}/projects/${name}`;
		await this.opts.fs.mkdir(dir, { recursive: true });
		await this.opts.fs.write(
			`${dir}/Pulumi.yaml`,
			`${JSON.stringify({ name, runtime: "yaml", ...program }, null, "\t")}\n`,
		);
		return dir;
	}

	/**
	 * Runs `pulumi <args>` in project directory `dir`, answering its stdout;
	 * throws its last line of stderr when it fails. `env` is added to the
	 * run's own, as a cloud token the program's provider reads.
	 */
	async run(
		dir: string,
		args: string[],
		opts: PulumiRunOptions = {},
	): Promise<string> {
		const passphrase = await this.opts.store.get(PULUMI_PASSPHRASE);
		if (passphrase === undefined) {
			throw new Error(
				"Pulumi has no passphrase for its state: do the setup step `pulumi-state`",
			);
		}
		const ran = await this.opts.ps.spawnCapture([this.paths.bin, ...args], {
			cwd: dir,
			env: {
				...pulumiEnv(this.paths),
				[PULUMI_PASSPHRASE]: passphrase,
				...opts.env,
			},
			stdin: opts.stdin ?? "",
			timeoutMs: RUN_MS,
		});
		if (ran.exitCode !== 0) {
			const why = ran.stderr
				.trim()
				.split("\n")
				.filter((line) => line.trim() !== "")
				.at(-1);
			throw new Error(
				`pulumi ${args[0]} failed: ${why ?? `exit ${ran.exitCode}`}`,
			);
		}
		return ran.stdout;
	}
}

/** What a `Pulumi` runs its CLI with. */
export interface PulumiOptions {
	ps: Ps;
	fs: Fs;
	/** splates's home, which `pulumiPaths` lays Pulumi out under. */
	home: string;
	/** Where the passphrase comes from, `PULUMI_PASSPHRASE` among the device creds. */
	store: SecretStore;
}

/** How long one `pulumi` run gets: an `up` waits for its machines to boot. */
const RUN_MS = 20 * 60_000;

/** What one `Pulumi.run` adds to a run. */
export interface PulumiRunOptions {
	/** Written to its stdin, as a secret config value. */
	stdin?: string;
	/** Added to its environment. */
	env?: Record<string, string>;
}

/**
 * Where the Pulumi worker provider keeps Pulumi on this machine: its CLI, and
 * its state in the local file backend, under splates's home rather than
 * `~/.pulumi`, so it never touches a Pulumi login the user has of their own.
 */
export interface PulumiPaths {
	/** What the CLI is installed into, as `--install-root`. */
	root: string;
	/** The `pulumi` program itself. */
	bin: string;
	/** Its own `PULUMI_HOME`, for plugins and logs, in place of `~/.pulumi`. */
	home: string;
	/** The file backend's directory, where every stack's state lives. */
	state: string;
	/** `state` as Pulumi names a backend, for `PULUMI_BACKEND_URL`. */
	backendUrl: string;
}

/** The device cred that encrypts the secrets in Pulumi's state, as Pulumi names it. */
export const PULUMI_PASSPHRASE = "PULUMI_CONFIG_PASSPHRASE";

/** The Pulumi CLI version splates installs, so every machine drives the same one. */
export const PULUMI_VERSION = "3.270.0";

/**
 * The `sh` command that installs Pulumi `PULUMI_VERSION` into `root`, as
 * Pulumi's official install script does, on any OS it builds for.
 */
export function pulumiInstallCommand(root: string): string {
	return `curl -fsSL https://get.pulumi.com | sh -s -- --version ${PULUMI_VERSION} --install-root ${shellWord(root)} --no-edit-path --silent`;
}

/** `text` as one word of a POSIX shell, bare when it needs no quoting. */
function shellWord(text: string): string {
	if (/^[\w/.@%+=:,-]+$/.test(text)) {
		return text;
	}
	return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** Pulumi's places under `home`, splates's own `~/.splates`. */
export function pulumiPaths(home: string): PulumiPaths {
	const root = `${home}/pulumi`;
	const state = `${root}/state`;
	return {
		root,
		bin: `${root}/bin/pulumi`,
		home: `${root}/home`,
		state,
		backendUrl: `file://${state}`,
	};
}

/**
 * The environment a `pulumi` run gets: its own home, the file backend, and no update
 * check. The passphrase is left to the caller, which reads it from the
 * device store only when the run needs it.
 */
export function pulumiEnv(paths: PulumiPaths): Record<string, string> {
	return {
		PULUMI_HOME: paths.home,
		PULUMI_BACKEND_URL: paths.backendUrl,
		PULUMI_SKIP_UPDATE_CHECK: "true",
		PULUMI_DIY_BACKEND_NO_LEGACY_WARNING: "true",
	};
}

/** A new passphrase: 32 random bytes, base64url. */
export function newPulumiPassphrase(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Buffer.from(bytes).toString("base64url");
}
