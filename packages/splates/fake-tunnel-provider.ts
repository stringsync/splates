import type { AsyncResource } from "webappwiz/disposable";
import type { TunnelProvider, TunnelRoute } from "./tunnel-provider";

/**
 * A TunnelProvider that publishes nothing and remembers what it was asked
 * for, so a test reads the steps back in order.
 */
export class FakeTunnelProvider implements TunnelProvider {
	private readonly calls: string[] = [];
	private unready: string | undefined;

	async ready(): Promise<void> {
		if (this.unready !== undefined) {
			throw new Error(this.unready);
		}
	}

	run({ host, url }: TunnelRoute): AsyncResource {
		this.calls.push(`run ${host} ${url}`);
		return {
			disposeAsync: async () => {
				this.calls.push(`stop ${host}`);
			},
		};
	}

	/** Makes `ready` throw, as an uninstalled tunnel does. */
	notReady(message: string): void {
		this.unready = message;
	}

	getCalls(): string[] {
		return this.calls;
	}
}
