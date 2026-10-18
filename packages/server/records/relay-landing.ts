import type { Landed, LandRequest, TrunkLanding } from "../trunk-landing";
import type { StateProject } from "./repo-state";

/**
 * A worker's landing: it asks the coordinator at `url` to land, through the
 * worker's relay, as `POST /api/land`.
 */
export class RelayLanding implements TrunkLanding {
	constructor(
		private readonly url: string,
		private readonly project: StateProject,
		private readonly send: typeof fetch = fetch,
	) {}

	async land(request: LandRequest): Promise<Landed> {
		const response = await this.send(`${this.url}/api/land`, {
			method: "POST",
			// The server refuses a write from any other origin than its own.
			headers: { "content-type": "application/json", origin: this.url },
			body: JSON.stringify({ project: this.project, request }),
		});
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
