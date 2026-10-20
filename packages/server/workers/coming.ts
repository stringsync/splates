import type { WorkerRegistry } from "./registry";

/** The slots of workers asked for that have yet to dial, which placement counts before making more. */
export class ComingWorkers {
	private readonly slots = new Map<string, number>();

	/** Notes worker `id`, asked for with `slots`, as on its way. */
	expect(id: string, slots: number): void {
		this.slots.set(id, slots);
	}

	/** Stops counting worker `id`, as when its machine is destroyed or never made. */
	forget(id: string): void {
		this.slots.delete(id);
	}

	/** The slots still on their way, once those `registry` has seen dial are dropped. */
	seats(registry: WorkerRegistry): number {
		let sum = 0;
		for (const [id, slots] of this.slots) {
			if (registry.worker(id)?.connected !== false) {
				this.slots.delete(id);
			} else {
				sum += slots;
			}
		}
		return sum;
	}
}
