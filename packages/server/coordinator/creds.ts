import type { SecretStore } from "webappwiz/creds";
import { z } from "zod";
import type { SecretStores } from "../creds";
import type { MovedProject } from "./paths";

/**
 * The creds the coordinator keeps, as the move carries them to the box:
 * `carried` reads them here, and `keep` keeps them in the box's stores.
 */
export class MovedCreds {
	constructor(private readonly stores: SecretStores) {}

	/** Every cred kept here that the box needs. */
	async carried(projects: MovedProject[]): Promise<CarriedCreds> {
		const carried: CarriedCreds = {
			device: await everything(
				this.stores.device,
				(name) => !SLOT_TOKEN.test(name),
			),
			projects: {},
		};
		for (const project of projects) {
			const kept = await everything(await this.stores.project(project.root));
			if (Object.keys(kept).length > 0) {
				carried.projects[project.boxRoot] = kept;
			}
		}
		return carried;
	}

	/** Keeps `carried` in these stores, answering how many. */
	async keep(carried: CarriedCreds): Promise<number> {
		let kept = 0;
		for (const [name, value] of Object.entries(carried.device)) {
			await this.stores.device.set(name, value);
			kept++;
		}
		for (const [root, creds] of Object.entries(carried.projects)) {
			const store = await this.stores.project(root);
			for (const [name, value] of Object.entries(creds)) {
				await store.set(name, value);
				kept++;
			}
		}
		return kept;
	}
}

/**
 * `splates server keep-creds`: keeps the creds the move sent, as JSON,
 * in `stores`, answering how many.
 */
export function keepCarriedCreds(opts: KeepCarriedOptions): Promise<number> {
	return new MovedCreds(opts.stores).keep(
		CarriedCreds.parse(JSON.parse(opts.sent)),
	);
}

/** What `keepCarriedCreds` keeps, and where. */
export interface KeepCarriedOptions {
	stores: SecretStores;
	/** What the move sent: `CarriedCreds` as JSON. */
	sent: string;
}

/** The creds the move carries: the device's, and each project's by its root on the box. */
export const CarriedCreds = z.object({
	device: z.record(z.string(), z.string()),
	projects: z.record(z.string(), z.record(z.string(), z.string())),
});
export type CarriedCreds = z.infer<typeof CarriedCreds>;

/**
 * A dev slot's tunnel token: each runs `splates server --slot` here, which
 * stays a dev server on this machine.
 */
const SLOT_TOKEN = /^SPLATES_SLOT_[A-Z0-9_]+_TUNNEL_TOKEN$/;

async function everything(
	store: SecretStore,
	wanted: (name: string) => boolean = () => true,
): Promise<Record<string, string>> {
	const values: Record<string, string> = {};
	for (const name of await store.names()) {
		const value = wanted(name) ? await store.get(name) : undefined;
		if (value !== undefined) {
			values[name] = value;
		}
	}
	return values;
}
