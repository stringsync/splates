import type { Logger } from "webappwiz/log";
import { z } from "zod";
import { refuse } from "../server/shared";
import { API_TOKEN } from "../tunnel";
import type { ServiceToken, WorkerAccess } from "./access";
import type { WorkerRecords } from "./records";

/** What `DELETE /api/workers/invite` is sent: the join token to withdraw. */
const Withdraw = z.object({ token: z.string() });

/**
 * `/api/workers/invite`: the join tokens the coordinator hands out, each
 * carrying a Cloudflare Access service token of the worker's own when
 * `access` stands in front, and the revoking of those tokens once no worker
 * will use them.
 */
export class WorkerInvites {
	constructor(
		private readonly records: WorkerRecords,
		private readonly access: WorkerAccess | null,
		private readonly log: Logger,
	) {}

	/**
	 * `POST /api/workers/invite`: a join token, single use, for `splates
	 * worker run --join`, carrying a service token of the worker's own when
	 * Cloudflare Access stands in front, so it can reach the join itself.
	 */
	async invite(): Promise<Response> {
		await this.revoke(await this.records.sweep());
		let access: ServiceToken | null = null;
		try {
			access = (await this.access?.mint()) ?? null;
		} catch (error) {
			return refuse(
				502,
				"cloudflare",
				`could not mint the worker a Cloudflare Access service token: ${error instanceof Error ? error.message : String(error)}. When the API token lacks Access: Service Tokens · Edit, \`splates creds request ${API_TOKEN} --device --replace\` asks for a new one`,
			);
		}
		return Response.json(await this.records.invite(access));
	}

	/**
	 * `DELETE /api/workers/invite`: withdraws a join token unspent, revoking
	 * the service token minted for it, as a deploy rolled back does with
	 * the one it asked the box for.
	 */
	async withdraw(request: Request): Promise<Response> {
		const body = Withdraw.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return refuse(400, "usage", "send the join token to withdraw");
		}
		const access = await this.records.withdraw(body.data.token);
		if (access !== null) {
			await this.revoke([access]);
		}
		return Response.json({ revoked: access });
	}

	/**
	 * Revokes each service token in `ids`, logging rather than failing when
	 * Cloudflare will not, since the worker's key is revoked already and
	 * Access alone lets no one in.
	 */
	async revoke(ids: string[]): Promise<void> {
		for (const id of ids) {
			try {
				await this.access?.revoke(id);
			} catch (error) {
				this.log.error(
					`could not revoke service token ${id}: ${error instanceof Error ? error.message : String(error)}; revoke it in Zero Trust → Access → Service Auth`,
				);
			}
		}
	}
}
