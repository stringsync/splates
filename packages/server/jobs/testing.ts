import type { Pools } from "./pools";

/** Pools a test sets: `sizes`, each whole, and `inUse`, what the machine is to measure. */
export class FakePools implements Pools {
	constructor(
		public sizes: Record<string, number> = {
			cpus: 8,
			mem: 16000,
			suite: 1,
		},
		public inUse: Record<string, number> = {},
	) {}

	async capacity(): Promise<Record<string, number>> {
		return { ...this.sizes };
	}

	async used(): Promise<Record<string, number>> {
		return { ...this.inUse };
	}
}
