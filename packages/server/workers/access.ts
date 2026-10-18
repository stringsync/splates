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

// A join token carries the service token after a dot, which neither its
// secret nor base64url ever holds, so `--join` stays one argument and the
// worker passes Access with it before it has joined.

/** The join token `base`, carrying `access`'s client id and secret when given. */
export function joinToken(base: string, access: AccessClient | null): string {
	if (access === null) {
		return base;
	}
	const carried = Buffer.from(
		`${access.clientId}\n${access.clientSecret}`,
	).toString("base64url");
	return `${base}.${carried}`;
}

/** The service token join token `token` carries, or null for none. */
export function joinAccess(token: string): AccessClient | null {
	const at = token.indexOf(".");
	if (at === -1) {
		return null;
	}
	const [clientId = "", clientSecret = ""] = Buffer.from(
		token.slice(at + 1),
		"base64url",
	)
		.toString()
		.split("\n");
	return clientId === "" || clientSecret === ""
		? null
		: { clientId, clientSecret };
}
