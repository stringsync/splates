import type { SecretStore } from "webappwiz/creds";
import type { Fs } from "webappwiz/system";
import type { Duration } from "webappwiz/time";
import { z } from "zod";
import { HetznerCloud } from "./hetzner";
import type { CloudProvider } from "./provider";

/** A cloud this machine can make the coordinator's box in, as setup offers it. */
export interface CloudChoice {
	/** How `cloud.json` and setup's answer name it, lowercase. */
	readonly id: string;
	/** What the user knows it as, as "Hetzner Cloud". */
	readonly name: string;
	make(opts: MachineCloudOptions): CloudProvider;
}

/** Every cloud setup offers, the first the one taken before any is chosen. */
export const CLOUDS: readonly [CloudChoice, ...CloudChoice[]] = [
	{
		id: "hetzner",
		name: "Hetzner Cloud",
		make: (opts) => new HetznerCloud(opts),
	},
];

/**
 * The cloud this machine makes the coordinator's box in, and whose token
 * its setup asks for: the one place outside a project's `splates.config.ts`
 * that picks a cloud. `opts.choice` names it, as `ChosenCloud` reads it;
 * none, or one no longer offered, takes the first of `CLOUDS`.
 */
export function machineCloud(opts: MachineCloudOptions = {}): CloudProvider {
	const { choice, ...rest } = opts;
	return (CLOUDS.find((each) => each.id === choice) ?? CLOUDS[0]).make(rest);
}

/** What `machineCloud` runs on; the real ones by default. */
export interface MachineCloudOptions {
	/** The id of the cloud to make, from `CLOUDS`; the first by default. */
	choice?: string;
	/** Where the cloud's token is kept: the device's creds. */
	store?: SecretStore;
	fetch?: typeof globalThis.fetch;
	/** How it waits between looks at the cloud's actions. */
	wait?: (duration: Duration) => Promise<void>;
}

/** The cloud the user chose in setup, kept in `~/.splates/cloud.json`. */
export class ChosenCloud {
	readonly #path: string;
	readonly #fs: Fs;

	constructor(home: string, fs: Fs) {
		this.#path = `${home}/cloud.json`;
		this.#fs = fs;
	}

	/** The chosen cloud's id, or null before one is chosen or once it is no longer offered. */
	async read(): Promise<string | null> {
		const raw = await this.#fs.read(this.#path).catch(() => null);
		if (raw === null) {
			return null;
		}
		const parsed = SAVED.safeParse(JSON.parse(raw));
		if (!parsed.success) {
			throw new Error(
				`${this.#path} is not what splates saved: remove it and choose a cloud in setup again`,
			);
		}
		const { cloud } = parsed.data;
		return CLOUDS.some((each) => each.id === cloud) ? cloud : null;
	}

	/** Keeps `id`, refusing one `CLOUDS` does not offer. */
	async choose(id: string): Promise<void> {
		if (!CLOUDS.some((each) => each.id === id)) {
			throw new Error(`splates offers no cloud '${id}'`);
		}
		await this.#fs.mkdir(this.#path.replace(/\/[^/]+$/, ""), {
			recursive: true,
		});
		// Through a temporary file, so a reader never sees half of it.
		const tmp = `${this.#path}.${crypto.randomUUID()}.tmp`;
		await this.#fs.write(
			tmp,
			`${JSON.stringify({ format: FORMAT, cloud: id }, null, "\t")}\n`,
		);
		await this.#fs.rename(tmp, this.#path);
	}

	/** The chosen cloud, or the first of `CLOUDS` before one is chosen. */
	async cloud(
		opts: Omit<MachineCloudOptions, "choice"> = {},
	): Promise<CloudProvider> {
		const choice = await this.read();
		return machineCloud(choice === null ? opts : { ...opts, choice });
	}
}

/** The file's own format. */
const FORMAT = 1;

const SAVED = z.object({ format: z.number(), cloud: z.string() });
