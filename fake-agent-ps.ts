import type { StartOptions } from "webappwiz/system";
import { type FakeChild, FakePs } from "webappwiz/system/testing";
import type { FakeAgent } from "./fake-agent";

/**
 * A `Ps` whose children are `agent`'s processes, for a worker to start
 * agents on in a test: what the worker writes to a child's stdin reaches
 * the agent, what the agent says comes out of its stdout, and a signal
 * sent the child kills the agent.
 */
export class FakeAgentPs extends FakePs {
	constructor(private readonly agent: FakeAgent) {
		super();
	}

	override start(argv: string[], opts?: StartOptions): FakeChild {
		const child = super.start(argv, opts);
		const process = this.agent.launch(argv, opts?.cwd ?? "/", opts?.env ?? {});
		void child.received.pipeTo(process.input).catch(() => {});
		void (async () => {
			for await (const chunk of process.output) {
				child.print(chunk);
			}
		})().catch(() => {});
		void process.exited.then((code) => child.exit(code));
		// A signal ends the child at once; the agent hears of it as a kill.
		void child.exited.then(() => {
			if (child.signals.length > 0) {
				process.kill();
			}
		});
		return child;
	}
}
