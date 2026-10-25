import { NodePs, type StartOptions } from "webappwiz/system";

export { type FaultDirection, FaultProxy } from "./fault-proxy";
export { WorkerSocketPair } from "./socket-pair";

/** Real processes unless a test needs a synchronous start failure. */
export class StartFailingPs extends NodePs {
	startFailure: Error | null = null;

	override start(argv: string[], opts?: StartOptions) {
		if (this.startFailure) {
			throw this.startFailure;
		}
		return super.start(argv, opts);
	}
}
