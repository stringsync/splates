import { keyIn } from "../storage";
import { type AwsCredentials, AwsSigner, encode, sha256 } from "./aws-sign";
import { byKey, type Replica, type ReplicaObject } from "./replica";

/** Where an S3-compatible bucket is, as a `splates.config.ts` names it. */
export interface S3Place {
	/** The service's address, as `https://<region>.digitaloceanspaces.com`. */
	endpoint: string;
	bucket: string;
	/** The region requests are signed for; `us-east-1` by default, which most stores take. */
	region?: string;
	/** The key everything is kept under in the bucket, so projects can share one; none by default. */
	prefix?: string;
}

export interface S3ReplicaOptions extends S3Place {
	/** The key and secret to sign with, read at each request so a cred saved later is taken. */
	credentials: () => Promise<AwsCredentials>;
	fetch?: typeof fetch;
	/** When a request is signed as made. */
	now?: () => Date;
}

/**
 * A replica in a bucket of any store that speaks S3's API (DigitalOcean
 * Spaces, Cloudflare R2, Backblaze B2, Tigris, MinIO), addressed by path,
 * as `<endpoint>/<bucket>/<key>`, and signed with SigV4 over fetch.
 */
export class S3Replica implements Replica {
	readonly name: string;
	private readonly fetch: typeof fetch;
	private readonly now: () => Date;
	private readonly prefix: string;

	constructor(private readonly opts: S3ReplicaOptions) {
		this.fetch = opts.fetch ?? fetch;
		this.now = opts.now ?? (() => new Date());
		this.prefix = opts.prefix?.replace(/^\/+|\/+$/g, "") ?? "";
		this.name = `s3://${opts.bucket}${this.prefix === "" ? "" : `/${this.prefix}`}`;
	}

	async put(key: string, bytes: Uint8Array): Promise<void> {
		await this.send("PUT", this.url(key), bytes);
	}

	async get(key: string): Promise<Uint8Array | null> {
		const response = await this.send("GET", this.url(key), "", [404]);
		return response.status === 404
			? null
			: new Uint8Array(await response.arrayBuffer());
	}

	async list(key: string): Promise<ReplicaObject[]> {
		const under = this.full(key);
		const found: ReplicaObject[] = [];
		let token: string | null = null;
		do {
			const url = this.at("");
			url.searchParams.set("list-type", "2");
			if (under !== "") {
				url.searchParams.set("prefix", `${under}/`);
			}
			if (token !== null) {
				url.searchParams.set("continuation-token", token);
			}
			const page = parseList(await (await this.send("GET", url, "")).text());
			for (const object of page.objects) {
				found.push({ ...object, key: this.relative(object.key) });
			}
			token = page.next;
		} while (token !== null);
		return found.sort(byKey);
	}

	async delete(key: string): Promise<void> {
		await this.send("DELETE", this.url(key), "", [404]);
	}

	/** The key in the bucket, under the prefix. */
	private full(key: string): string {
		return keyIn(this.prefix, key);
	}

	private relative(key: string): string {
		return this.prefix === "" ? key : key.slice(this.prefix.length + 1);
	}

	/** The object's address, each part of its key percent-encoded. */
	private url(key: string): URL {
		return this.at(this.full(key));
	}

	/** The address of `key` in the bucket, or the bucket's for `""`. */
	private at(key: string): URL {
		const path = [this.opts.bucket, ...key.split("/")]
			.filter((part) => part !== "")
			.map(encode)
			.join("/");
		return new URL(`${this.opts.endpoint.replace(/\/+$/, "")}/${path}`);
	}

	/** Sends a signed request, throwing on a status that is not a success or one of `allowed`. */
	private async send(
		method: string,
		url: URL,
		body: string | Uint8Array,
		allowed: number[] = [],
	): Promise<Response> {
		const signer = new AwsSigner(
			await this.opts.credentials(),
			this.opts.region ?? "us-east-1",
			"s3",
		);
		const headers = signer.sign(
			{
				method,
				url,
				headers: { "x-amz-content-sha256": sha256(body) },
				body,
			},
			this.now(),
		);
		const response = await this.fetch(url, {
			method,
			headers,
			body: method === "PUT" ? new Uint8Array(encodeBody(body)) : undefined,
		});
		if (!response.ok && !allowed.includes(response.status)) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`${this.name}: ${method} ${url.pathname} answered ${response.status}${errorCode(text)}`,
			);
		}
		return response;
	}
}

/** One page of a ListObjectsV2 answer. */
function parseList(xml: string): {
	objects: ReplicaObject[];
	next: string | null;
} {
	const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(
		([, body]) => ({
			key: unescapeXml(tag(body ?? "", "Key")),
			size: Number(tag(body ?? "", "Size")),
			md5: unescapeXml(tag(body ?? "", "ETag")).replace(/"/g, ""),
		}),
	);
	const truncated = tag(xml, "IsTruncated") === "true";
	const next = tag(xml, "NextContinuationToken");
	return { objects, next: truncated && next !== "" ? unescapeXml(next) : null };
}

function tag(xml: string, name: string): string {
	return xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "";
}

function unescapeXml(text: string): string {
	return text
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

/** The `<Code>` of an S3 error answer, as `: NoSuchBucket`, or nothing. */
function errorCode(xml: string): string {
	const code = tag(xml, "Code");
	return code === "" ? "" : `: ${code}`;
}

function encodeBody(body: string | Uint8Array): Uint8Array {
	return typeof body === "string" ? new TextEncoder().encode(body) : body;
}
