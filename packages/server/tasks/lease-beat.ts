import type { Resource } from "webappwiz/disposable";
import { Duration, type Timer } from "webappwiz/time";
import type { WorktreeService } from "./worktree-service";

/**
 * Keeps the leases this process takes fresh while it runs, for a command on
 * a worker: a holder on another host than the server's is judged by its
 * lease's `heartbeatAt` alone, so one long merge would read as gone. Each
 * lease beats until the process lets it go or another takes it; the beats
 * end with the command, and the lease goes stale after, as it does locally.
 */
export class LeaseBeat {
	private readonly beats = new Map<string, Resource>();

	constructor(
		private readonly timer: Timer,
		private readonly stalenessMs: number,
	) {}

	/** Starts beating `task`'s lease, which this process has just taken. */
	held(service: WorktreeService, task: string): void {
		if (this.beats.has(task)) {
			return;
		}
		this.beats.set(
			task,
			this.timer.setInterval(
				() => void this.beat(service, task).catch(() => {}),
				Duration.ms(this.stalenessMs / 3),
			),
		);
	}

	private async beat(service: WorktreeService, task: string): Promise<void> {
		const found = await service.find(task);
		const { lease } = found;
		if (lease === null || !found.leaseOurs) {
			this.stop(task);
			return;
		}
		await found.save({
			lease: { ...lease, heartbeatAt: new Date().toISOString() },
		});
	}

	private stop(task: string): void {
		this.beats.get(task)?.dispose();
		this.beats.delete(task);
	}

	/** Ends every beat, as the command ends. */
	dispose(): void {
		for (const task of [...this.beats.keys()]) {
			this.stop(task);
		}
	}
}
