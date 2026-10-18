import type { ServiceToken, WorkerAccess } from "./access";

/** Service tokens a test mints and revokes, in memory: Access as it stands, and each revoked. */
export class FakeWorkerAccess implements WorkerAccess {
	/** The tokens minted and not yet revoked, by id. */
	readonly live = new Map<string, ServiceToken>();
	readonly revoked: string[] = [];
	/** What minting throws, as Cloudflare refusing would. */
	failing: Error | null = null;
	private next = 1;

	async mint(): Promise<ServiceToken> {
		if (this.failing !== null) {
			throw this.failing;
		}
		const made = this.next++;
		const token = {
			id: `st-${made}`,
			clientId: `client-${made}.access`,
			clientSecret: `secret-${made}`,
		};
		this.live.set(token.id, token);
		return token;
	}

	async revoke(id: string): Promise<void> {
		this.live.delete(id);
		this.revoked.push(id);
	}
}
