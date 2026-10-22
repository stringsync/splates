import type { Platform, WorkerType } from "./provider";
import { snapshotRecipe } from "./snapshot";

/** What worker `WorkerProvisioning.provision` is asked for. */
export interface ProvisionOptions {
	/** The provider's type to make; by default its cheapest. */
	type?: string;
	/** The platform the cheapest must run; null or unset for any. */
	platform?: Platform | null;
}

/**
 * The type `opts` asks for: the one it names, else the cheapest on its
 * platform among those splates can build a snapshot for.
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
	const [cheapest] = bootable.sort(
		(one, other) => one.dollarsPerHour - other.dollarsPerHour,
	);
	return cheapest as WorkerType;
}
