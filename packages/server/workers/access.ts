/**
 * A Cloudflare Access service token minted for one worker: its id, which
 * revokes it, and the client id and secret it sends on every request.
 */
export interface ServiceToken {
	id: string;
	clientId: string;
	clientSecret: string;
}

/** What a worker shows Cloudflare Access: a service token's two halves. */
export type AccessClient = Pick<ServiceToken, "clientId" | "clientSecret">;

/**
 * Where a coordinator behind Cloudflare Access gets each worker it invites
 * past Access, and takes it back once the worker is removed.
 */
export interface WorkerAccess {
	/** A new service token Access lets through; null when there is no way to mint one, as without the API token. */
	mint(): Promise<ServiceToken | null>;
	/** Revokes service token `id`, passing over one already gone. */
	revoke(id: string): Promise<void>;
}

/** The headers Cloudflare Access reads a service token from. */
export const ACCESS_CLIENT_ID_HEADER = "cf-access-client-id";
export const ACCESS_CLIENT_SECRET_HEADER = "cf-access-client-secret";

/** `client`'s halves as the headers Access reads them from; none for none. */
export function accessHeaders(
	client: AccessClient | null,
): Record<string, string> {
	return client === null
		? {}
		: {
				[ACCESS_CLIENT_ID_HEADER]: client.clientId,
				[ACCESS_CLIENT_SECRET_HEADER]: client.clientSecret,
			};
}

// A join token carries the service token after a dot, then the coordinator's
// public key after a second, which neither its secret nor base64url ever
// holds, so `--join` stays one argument and the worker passes Access with it
// before it has joined. Either part is empty when the token has none.

/** The join token `base`, carrying `access`'s client id and secret and the coordinator's `publicKey` when given. */
export function joinToken(
	base: string,
	access: AccessClient | null,
	publicKey: string | null = null,
): string {
	if (access === null && publicKey === null) {
		return base;
	}
	const carried =
		access === null
			? ""
			: Buffer.from(`${access.clientId}\n${access.clientSecret}`).toString(
					"base64url",
				);
	return publicKey === null
		? `${base}.${carried}`
		: `${base}.${carried}.${publicKey}`;
}

/** The service token join token `token` carries, or null for none. */
export function joinAccess(token: string): AccessClient | null {
	const carried = token.split(".")[1] ?? "";
	const [clientId = "", clientSecret = ""] = Buffer.from(carried, "base64url")
		.toString()
		.split("\n");
	return clientId === "" || clientSecret === ""
		? null
		: { clientId, clientSecret };
}

/** The coordinator's public key join token `token` carries, or null for a token from before they did. */
export function joinCoordinatorKey(token: string): string | null {
	return token.split(".")[2] || null;
}
