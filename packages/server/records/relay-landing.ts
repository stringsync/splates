import { Duration } from "webappwiz/time";
import type { Landed, LandRequest, TrunkLanding } from "../merge";
import type { RelaySend, StateProject } from "./repo-state";

/**
 * How long a landing may go unanswered: it runs while the merge lease is
 * held, so a relay that hangs would otherwise hold the lease with it.
 */
export const LAND_WITHIN = Duration.mins(5);

/** What `RelayLanding` reaches the server through, and how long it waits. */
export interface RelayLandingOptions {
	/** The global `fetch` by default. */
	fetch?: RelaySend;
	within?: Duration;
}

/**
 * A worker's landing: it asks the server at `url` to land, through the
 * worker's relay, as `POST /api/land`.
 */
export class RelayLanding implements TrunkLanding {
	private readonly send: RelaySend;
	private readonly within: Duration;

	constructor(
		private readonly url: string,
		private readonly project: StateProject,
		opts: RelayLandingOptions = {},
	) {
		this.send = opts.fetch ?? fetch;
		this.within = opts.within ?? LAND_WITHIN;
	}

	async land(request: LandRequest): Promise<Landed> {
		const signal = AbortSignal.timeout(this.within.ms);
		const response = await this.send(`${this.url}/api/land`, {
			method: "POST",
			// The server refuses a write from any other origin than its own.
			headers: { "content-type": "application/json", origin: this.url },
			body: JSON.stringify({ project: this.project, request }),
			signal,
		}).catch((error: unknown) => {
			if (!signal.aborted) {
				throw error;
			}
			return null;
		});
		if (response === null) {
			return {
				status: "refused",
				why: `the coordinator did not answer the landing within ${this.within.secs}s, so trunk may or may not have moved`,
			};
		}
		const body = (await response.json().catch(() => null)) as {
			value?: Landed;
			message?: string;
		} | null;
		if (!response.ok || body?.value === undefined) {
			return {
				status: "refused",
				why: `the coordinator did not land it: ${body?.message ?? response.status}`,
			};
		}
		return body.value;
	}
}
