import { type Fs, NodeFs, NodePs, type Ps } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import { z } from "zod";
import { AwsCloud } from "../cloud";
import { splatesHome } from "../models";
import type { TunnelRecord } from "../tunnel/saved";
import { type InfraConfig, infraConfigPath, readInfraConfig } from "./infra";

/**
 * The coordinator's always-on box in the user's AWS account, which the
 * user's Pulumi project made (`splates server infra init`): this reads the
 * stack's outputs for where it is, and gets what the deploy needs to reach
 * it, its SSH key and its host key. It runs `pulumi up` and `pulumi destroy`
 * for the user, picking up where a failed run left the stack, so they never
 * run Pulumi themselves.
 */
export class CoordinatorBox {
	private readonly ps: Ps;
	private readonly fs: Fs;
	/** splates's home, under whose `coordinator` the box's SSH files are kept. */
	readonly home: string;
	/** Where its SSH key is kept, read once from the stack. */
	readonly key: string;
	/** Where the box's address is kept with its host key, for `ssh` to hold it to. */
	readonly knownHosts: string;

	constructor(private readonly opts: CoordinatorBoxOptions = {}) {
		this.ps = opts.ps ?? new NodePs();
		this.fs = opts.fs ?? new NodeFs();
		this.home = opts.home ?? splatesHome(this.ps);
		this.key = `${this.home}/coordinator/id_ed25519`;
		this.knownHosts = `${this.home}/coordinator/known_hosts`;
	}

	/** The recorded infra project; null when `splates server infra init` has not run here. */
	infra(): Promise<InfraConfig | null> {
		return readInfraConfig(this.fs, this.home);
	}

	/** The box as the stack's outputs have it, or null when there is none. */
	async status(): Promise<BoxStanding | null> {
		const infra = await this.infra();
		if (infra === null) {
			return null;
		}
		const outputs = Outputs.safeParse(
			JSON.parse(await this.pulumi(infra, ["stack", "output", "--json"])),
		);
		if (!outputs.success) {
			return null;
		}
		const { instanceId, ipv4, roleName, tunnelHost, tunnelRecord } =
			outputs.data;
		return {
			ipv4,
			instanceId,
			roleName,
			host: tunnelHost,
			...(tunnelRecord === undefined
				? {}
				: {
						tunnel: {
							host: tunnelHost,
							team: tunnelRecord.team,
							aud: tunnelRecord.aud,
							tunnel: tunnelRecord.id,
						},
					}),
			key: infra.key ?? this.key,
		};
	}

	/** What `pulumi preview` says the stack would change, as its summary line. */
	async preview(): Promise<string> {
		const infra = await this.infraOrThrow();
		await this.ensureStack(infra);
		const out = await this.pulumi(infra, ["preview", "--non-interactive"]);
		return summaryOf(out);
	}

	/**
	 * Makes what the stack describes, `pulumi up --yes`; throws the line
	 * `pulumi` failed with. The state is refreshed first, so a run after a
	 * failed one carries on from what is really there: what the failure left
	 * half made is picked up, and what was deleted by hand is made again.
	 */
	async up(): Promise<void> {
		const infra = await this.infraOrThrow();
		await this.ensureStack(infra);
		await this.refresh(infra);
		await this.pulumi(infra, ["up", "--yes", "--non-interactive"]);
	}

	/**
	 * Unmakes everything the stack made, `pulumi destroy --yes`, lifting the
	 * termination protection the box has first, and forgets the box's login
	 * and host keys kept here, so a box made next gets its own. The state is
	 * refreshed first, so what is already gone, such as a deploy key deleted
	 * by hand, stops nothing. The stack and its config stay for `remove`.
	 */
	async destroy(): Promise<void> {
		const infra = await this.infraOrThrow();
		const standing = await this.status();
		if (standing !== null) {
			const cloud = this.cloud();
			if ((await cloud.machine(standing.instanceId)) !== null) {
				await cloud.protect(standing.instanceId, false);
			}
		}
		await this.refresh(infra);
		await this.pulumi(infra, ["destroy", "--yes", "--non-interactive"]);
		if (infra.key === undefined) {
			await this.fs.rm(this.key).catch(() => {});
			await this.fs.rm(`${this.key}.pub`).catch(() => {});
		}
		if (standing !== null && (await this.fs.exists(this.knownHosts))) {
			const kept = (await this.fs.read(this.knownHosts))
				.split("\n")
				.filter((line) => !line.startsWith(`${standing.ipv4} `))
				.join("\n");
			await this.fs.write(this.knownHosts, kept);
		}
	}

	/**
	 * Forgets the stack, `pulumi stack rm`, and the infra project recorded
	 * here, once `destroy` has unmade what it made: Pulumi refuses to remove
	 * a stack that still has resources. The project's files are the user's
	 * to delete.
	 */
	async remove(): Promise<void> {
		const infra = await this.infraOrThrow();
		// A project whose stack was never made, or is gone, is forgotten all the same.
		await this.pulumi(infra, ["stack", "rm", "--yes"]).catch((error) => {
			if (!/no stack named/i.test(String(error))) {
				throw error;
			}
		});
		await this.fs.rm(infraConfigPath(this.home));
	}

	/**
	 * Makes the stack in the backend if it is not there yet: `infra init`
	 * writes only the stack's config file, so the first run would otherwise
	 * fail with "no stack named". Selecting an existing stack changes nothing.
	 */
	private async ensureStack(infra: InfraConfig): Promise<void> {
		if (infra.stack === undefined) {
			return;
		}
		const ran = await this.ps.spawnCapture(
			[
				"pulumi",
				"stack",
				"select",
				"--create",
				infra.stack,
				"--non-interactive",
			],
			{ cwd: infra.dir },
		);
		if (ran.exitCode !== 0) {
			throw new Error(
				`pulumi stack select in ${infra.dir} failed: ${failureLine(`${ran.stdout}\n${ran.stderr}`)}`,
			);
		}
	}

	/** Brings the state in line with what is really there; `--yes` applies every difference. */
	private async refresh(infra: InfraConfig): Promise<void> {
		await this.pulumi(infra, ["refresh", "--yes", "--non-interactive"]);
	}

	private cloud(): BoxCloud {
		return this.opts.cloud ?? new AwsCloud();
	}

	/**
	 * Points the stack's tunnel at `host` and applies it, which moves the
	 * tunnel's DNS record and Access application there; answers the box as the
	 * stack then has it.
	 */
	async retarget(host: string): Promise<BoxStanding> {
		const infra = await this.infraOrThrow();
		await this.ensureStack(infra);
		await this.pulumi(infra, ["config", "set", "splates:host", host]);
		await this.up();
		return this.ready();
	}

	private async infraOrThrow(): Promise<InfraConfig> {
		const infra = await this.infra();
		if (infra === null) {
			throw new Error(
				"no infra project here: `splates server infra init <dir>` writes one",
			);
		}
		return infra;
	}

	/**
	 * The box, with a login: its key kept from the stack when it is not yet,
	 * and its host key, which the box printed to its console on first boot,
	 * recorded for its address. Waits for the console to say it.
	 */
	async ready(): Promise<BoxStanding> {
		const standing = await this.status();
		if (standing === null) {
			const infra = await this.infra();
			throw new Error(
				infra === null
					? "no infra project here: `splates server infra init <dir>` writes one, and `pulumi up` in it makes the box"
					: `the stack in ${infra.dir} has no box yet: \`pulumi up\` there makes it`,
			);
		}
		await this.keep();
		await this.trust(standing);
		return standing;
	}

	/** Keeps the stack's `sshKey` at `this.key`, unless the user named a key of their own or it is kept. */
	private async keep(): Promise<void> {
		const infra = await this.infra();
		if (infra?.key !== undefined || (await this.fs.exists(this.key))) {
			return;
		}
		const key = await this.pulumi(infra as InfraConfig, [
			"stack",
			"output",
			"sshKey",
			"--show-secrets",
		]);
		await this.fs.mkdir(this.key.slice(0, this.key.lastIndexOf("/")), {
			recursive: true,
		});
		await this.fs.write(this.key, `${key.trim()}\n`);
		await this.fs.chmod(this.key, 0o600);
	}

	/**
	 * Records the box at its address as holding the host keys its console
	 * printed, so `ssh` knows them before first connecting and refuses any
	 * other. An address already recorded stays as it was.
	 */
	private async trust(standing: BoxStanding): Promise<void> {
		const { ipv4, instanceId } = standing;
		const known = (await this.fs.exists(this.knownHosts))
			? await this.fs.read(this.knownHosts)
			: "";
		if (known.split("\n").some((line) => line.startsWith(`${ipv4} `))) {
			return;
		}
		const cloud = this.cloud();
		const until = Date.now() + (this.opts.within ?? Duration.mins(10)).ms;
		let keys: string[] = [];
		for (;;) {
			keys = hostKeys(await cloud.consoleOutput(instanceId));
			if (keys.length > 0) {
				break;
			}
			if (Date.now() > until) {
				throw new Error(
					`the box at ${ipv4} has not printed its host keys to its console yet: it is still booting, so deploy again in a minute or two`,
				);
			}
			await (this.opts.wait ?? sleep)(Duration.secs(10));
		}
		await this.fs.mkdir(
			this.knownHosts.slice(0, this.knownHosts.lastIndexOf("/")),
			{
				recursive: true,
			},
		);
		await this.fs.write(
			this.knownHosts,
			`${known}${keys.map((key) => `${ipv4} ${key}\n`).join("")}`,
		);
	}

	/**
	 * Runs `pulumi` in the project. A run that a killed one still holds the
	 * stack's lock against (`pulumi` was stopped mid-update) cancels that
	 * lock, `pulumi cancel`, and runs once more.
	 */
	private async pulumi(
		infra: InfraConfig,
		args: string[],
		cancelled = false,
	): Promise<string> {
		const stack = infra.stack === undefined ? [] : ["--stack", infra.stack];
		const ran = await this.ps.spawnCapture(["pulumi", ...args, ...stack], {
			cwd: infra.dir,
		});
		if (ran.exitCode !== 0) {
			const output = `${ran.stdout}\n${ran.stderr}`;
			if (!cancelled && LOCKED.test(output)) {
				await this.ps.spawnCapture(["pulumi", "cancel", "--yes", ...stack], {
					cwd: infra.dir,
				});
				return this.pulumi(infra, args, true);
			}
			throw new Error(
				`pulumi ${args.slice(0, 2).join(" ")} in ${infra.dir} failed: ${failureLine(output)}`,
			);
		}
		return ran.stdout;
	}
}

/**
 * How `pulumi` says a stack is locked by an update still in progress: Pulumi
 * Cloud answers 409, a self-managed backend names the lock.
 */
const LOCKED = /another update is currently in progress|currently locked by/i;

/**
 * The line that says what a failed `pulumi` run failed on: the first
 * resource's error under Diagnostics, after the resource it names, since
 * the run's own `error: update failed` says only that it failed, with the
 * `* ` causes an `N errors occurred:` goes on to list; else its last
 * `error:` line, else its last.
 */
export function failureLine(output: string): string {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	const at = lines.findIndex(
		(line) => line.startsWith("error:") && !/^error: \w+ failed$/.test(line),
	);
	if (at !== -1) {
		const causes: string[] = [];
		for (const line of lines.slice(at + 1)) {
			if (!line.startsWith("* ")) {
				break;
			}
			causes.push(line);
		}
		const error = [lines[at], ...causes]
			.join(" ")
			.replace(/^error:\s*/, "")
			.replace(/\s*\{$/, "");
		const resource = lines[at - 1]?.match(/^(\S+ \(.+\)):$/)?.[1];
		return resource === undefined ? `error: ${error}` : `${resource}: ${error}`;
	}
	return (
		lines.findLast((line) => line.startsWith("error:")) ?? lines.at(-1) ?? ""
	);
}

/** The `Resources:` summary of a `pulumi preview`, as "3 to create". */
export function summaryOf(output: string): string {
	const lines = output.split("\n");
	const at = lines.findIndex((line) => line.trim().startsWith("Resources:"));
	const found =
		at < 0
			? []
			: lines
					.slice(at + 1)
					.map((line) => line.trim())
					.filter((line) => /^[+~-]\s*\d+ /.test(line))
					.map((line) => line.replace(/^[+~-]\s*/, ""));
	return found.length === 0 ? "nothing to change" : found.join(", ");
}

/** The host keys an Ubuntu box prints to its console, as `type data` lines for a known_hosts file. */
export function hostKeys(output: string): string[] {
	const block = output.match(
		/-----BEGIN SSH HOST KEY KEYS-----\n([\s\S]*?)-----END SSH HOST KEY KEYS-----/,
	);
	return (block?.[1] ?? "").split("\n").flatMap((line) => {
		const [type, data] = line.trim().split(/\s+/);
		return type?.startsWith("ssh-") || type?.startsWith("ecdsa-")
			? [`${type} ${data}`]
			: [];
	});
}

/** What a `CoordinatorBox` runs on; the real ones by default. */
export interface CoordinatorBoxOptions {
	ps?: Ps;
	fs?: Fs;
	/** splates's home, where the infra project is recorded and the box's SSH files are. */
	home?: string;
	/** The cloud the box is in, AWS here by default. */
	cloud?: BoxCloud;
	/** How long the box has to print its host keys. */
	within?: Duration;
	/** How it waits between looks at the console. */
	wait?: (duration: Duration) => Promise<void>;
}

/** What the box's cloud answers about it: its console, whether it is there, and its termination protection. */
export interface BoxCloud {
	consoleOutput(id: string): Promise<string>;
	/** The instance, or null once it is gone. */
	machine(id: string): Promise<unknown>;
	protect(id: string, on: boolean): Promise<void>;
}

/** The box as its stack says it stands. */
export interface BoxStanding {
	ipv4: string;
	/** The EC2 instance's id. */
	instanceId: string;
	/** Its instance role, whose Parameter Store it reads its creds from. */
	roleName: string;
	/** The host the tunnel serves it through. */
	host: string;
	/** What the box's `tunnel.json` holds, from the stack; absent from a stack that predates it. */
	tunnel?: TunnelRecord;
	/** The private key that logs in as root. */
	key: string;
}

/** The stack outputs `splates server infra init`'s program exports. */
const Outputs = z.object({
	instanceId: z.string(),
	ipv4: z.string(),
	roleName: z.string(),
	tunnelHost: z.string(),
	tunnelRecord: z
		.object({ team: z.string(), aud: z.string(), id: z.string() })
		.optional(),
});

/** The user splates runs as on the box, as on a worker. */
export const BOX_USER = "splates";

/** Where the latest cloudflared for the box's Ubuntu comes from. */
export const CLOUDFLARED_DEB =
	"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb";
