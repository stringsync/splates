import { createHash, createHmac } from "node:crypto";

/** What signs a request: an access key, its secret, and a session token when it is temporary. */
export interface AwsCredentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
}

/** A request to sign, its body already in the form it is sent. */
export interface SigningRequest {
	method: string;
	url: URL;
	headers: Record<string, string>;
	body: string;
}

/**
 * Signs requests to AWS with Signature Version 4, so splates needs no AWS
 * SDK: `sign` answers the headers to send, the `Authorization` among them.
 */
export class AwsSigner {
	constructor(
		private readonly credentials: AwsCredentials,
		private readonly region: string,
		private readonly service: string,
	) {}

	/** The request's headers with `host`, `x-amz-date` and `Authorization` added, signed as of `at`. */
	sign(request: SigningRequest, at: Date): Record<string, string> {
		const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
		const day = stamp.slice(0, 8);
		const headers: Record<string, string> = {
			...Object.fromEntries(
				Object.entries(request.headers).map(([name, value]) => [
					name.toLowerCase(),
					value,
				]),
			),
			host: request.url.host,
			"x-amz-date": stamp,
		};
		if (this.credentials.sessionToken !== undefined) {
			headers["x-amz-security-token"] = this.credentials.sessionToken;
		}
		const names = Object.keys(headers).sort();
		const canonical = [
			request.method,
			request.url.pathname,
			canonicalQuery(request.url),
			names.map((name) => `${name}:${headers[name]?.trim()}\n`).join(""),
			names.join(";"),
			hex(request.body),
		].join("\n");
		const scope = `${day}/${this.region}/${this.service}/aws4_request`;
		const toSign = ["AWS4-HMAC-SHA256", stamp, scope, hex(canonical)].join(
			"\n",
		);
		let key: Buffer | string = `AWS4${this.credentials.secretAccessKey}`;
		for (const part of [day, this.region, this.service, "aws4_request"]) {
			key = createHmac("sha256", key).update(part).digest();
		}
		const signature = createHmac("sha256", key).update(toSign).digest("hex");
		return {
			...headers,
			Authorization: `AWS4-HMAC-SHA256 Credential=${this.credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
		};
	}
}

function hex(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** The query's pairs sorted by name then value, each percent-encoded as SigV4 asks. */
function canonicalQuery(url: URL): string {
	return [...url.searchParams.entries()]
		.map(([name, value]) => [encode(name), encode(value)] as const)
		.sort(([ak, av], [bk, bv]) =>
			ak === bk ? (av < bv ? -1 : 1) : ak < bk ? -1 : 1,
		)
		.map(([name, value]) => `${name}=${value}`)
		.join("&");
}

/** `text` percent-encoded but for unreserved characters, which `encodeURIComponent` leaves `!'()*` of. */
export function encode(text: string): string {
	return encodeURIComponent(text).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}
