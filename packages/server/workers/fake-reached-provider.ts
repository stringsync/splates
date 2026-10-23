import { RunnerGone } from "../cloud/runner-gone";
import { FakeWorkerProvider } from "./fake-provider";
import { JOBS } from "./job";
import { WorkerSession } from "./session";
import type { WorkerSocket } from "./socket";
import { WorkerSocketPair } from "./socket-pair";

/**
 * A provider whose workers the server reaches, as Fly's are: each `reach`
 * answers one end of an in-memory pair whose other end says a runner's
 * hello once told `ready`, as the runner image's job server does.
 */
export class FakeReachedProvider extends FakeWorkerProvider {
	/** Each worker reached, in order, once per dial. */
	readonly reached: string[] = [];
	/** The links it handed out, the latest last, to drop one. */
	readonly links: WorkerSocketPair[] = [];

	async reach(id: string): Promise<WorkerSocket> {
		this.reached.push(id);
		if (!(await this.list()).some((machine) => machine.id === id)) {
			throw new RunnerGone(id);
		}
		const pair = new WorkerSocketPair();
		const session = new WorkerSession("worker", { capabilities: [JOBS] });
		const off = pair.worker.events.on("frame", (frame) => {
			if (frame !== "ready") {
				return;
			}
			off();
			void session.connect(pair.worker, {
				id,
				info: {
					jobs: true,
					slots: 0,
					platform: "linux",
					build: "1.0.0",
					cpus: 4,
					memory: 8,
				},
			});
		});
		this.links.push(pair);
		return pair.coordinator;
	}
}
