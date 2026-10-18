import { MemoryWorkerSocket } from "./memory-worker-socket";

/** Two ends of an in-memory connection, for tests. */
export class WorkerSocketPair {
	readonly worker = new MemoryWorkerSocket();
	readonly coordinator = new MemoryWorkerSocket();

	constructor() {
		this.worker.peer = this.coordinator;
		this.coordinator.peer = this.worker;
	}

	/** Drops the link mid-stream: whatever is still on the way is lost. */
	drop(): void {
		this.worker.drop();
	}
}
