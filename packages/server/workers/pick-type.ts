import type { WorkerType } from "./provider";
import type { Platform } from "./scheduler";
import { snapshotRecipe } from "./snapshot";

/** What worker `WorkerProvisioning.provision` is asked for. */
export interface ProvisionOptions {
	/** The provider's type to make; by default its cheapest. */
	type?: string;
	/** The platform the cheapest must run; null or unset for any. */
	platform?: Platform | null;
	/** The agent it is made for, which says why none fits. */
	agent?: string;
	/** Whether workers of a type, by name, can run what it is made for; any can, unless said. */
	runs?: (type: string) => boolean;
}

/**
 * The type `opts` asks for: the one it names, else the cheapest on its
 * platform among those splates can build a snapshot for whose workers hold
 * the key its agent runs on.
 */
export function pickType(
	types: WorkerType[],
	opts: ProvisionOptions,
): WorkerType {
	if (opts.type !== undefined) {
		const named = types.find((each) => each.name === opts.type);
		if (named === undefined) {
			throw new Error(
				`the worker provider makes no ${opts.type}: it makes ${types.map((each) => each.name).join(", ") || "nothing"}`,
			);
		}
		return named;
	}
	const bootable = types.filter(
		(each) =>
			(opts.platform == null || each.platform === opts.platform) &&
			snapshotRecipe(each.platform, "") !== null,
	);
	if (bootable.length === 0) {
		throw new Error(
			`the worker provider makes no worker splates can boot${opts.platform == null ? "" : ` on ${opts.platform}`}`,
		);
	}
	const [cheapest] = bootable
		.filter((each) => opts.runs?.(each.name) ?? true)
		.sort((one, other) => one.dollarsPerHour - other.dollarsPerHour);
	if (cheapest === undefined) {
		throw new Error(
			`no type of worker the provider makes holds a key for ${opts.agent ?? "its agent"}: add one for a type on the Creds page`,
		);
	}
	return cheapest;
}
