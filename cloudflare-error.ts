/** A call Cloudflare refused, with the HTTP status it answered. */
export class CloudflareError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}
