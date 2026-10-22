import { type AwsCredentials, AwsSigner } from "./aws-sign";
import { md5 } from "./replica";

/**
 * An S3-compatible store behind a fake `fetch`, keeping objects of one bucket
 * in memory and answering 403 to a request not signed with `credentials`,
 * so `S3Replica` is tested against the API it speaks.
 */
export class FakeS3 {
	readonly objects = new Map<string, Uint8Array>();
	/** How many objects a listing answers per page, small to test paging. */
	pageSize = 1000;

	constructor(
		readonly bucket: string,
		readonly credentials: AwsCredentials,
		readonly region = "us-east-1",
	) {}

	readonly fetch = (async (input: string | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const method = init?.method ?? "GET";
		const headers = (init?.headers ?? {}) as Record<string, string>;
		const body: Uint8Array =
			init?.body instanceof Uint8Array ? init.body : new Uint8Array();
		if (!this.signed(method, url, headers, body)) {
			return xml(403, "<Error><Code>SignatureDoesNotMatch</Code></Error>");
		}
		const [bucket, ...parts] = url.pathname
			.slice(1)
			.split("/")
			.map(decodeURIComponent);
		if (bucket !== this.bucket) {
			return xml(404, "<Error><Code>NoSuchBucket</Code></Error>");
		}
		const key = parts.join("/");
		if (key === "" && method === "GET") {
			return this.listing(url.searchParams);
		}
		if (method === "PUT") {
			this.objects.set(key, body.slice());
			return new Response(null, { status: 200 });
		}
		if (method === "DELETE") {
			this.objects.delete(key);
			return new Response(null, { status: 204 });
		}
		const held = this.objects.get(key);
		return held === undefined
			? xml(404, "<Error><Code>NoSuchKey</Code></Error>")
			: new Response(held.slice(), { status: 200 });
	}) as unknown as typeof globalThis.fetch;

	/** Whether the request carries the signature `credentials` make of it. */
	private signed(
		method: string,
		url: URL,
		headers: Record<string, string>,
		body: Uint8Array,
	): boolean {
		const date = headers["x-amz-date"] ?? "";
		const at = new Date(
			`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`,
		);
		const resigned = new AwsSigner(this.credentials, this.region, "s3").sign(
			{
				method,
				url,
				headers: {
					"x-amz-content-sha256": headers["x-amz-content-sha256"] ?? "",
				},
				body,
			},
			at,
		);
		return resigned.Authorization === headers.Authorization;
	}

	private listing(query: URLSearchParams): Response {
		const prefix = query.get("prefix") ?? "";
		const keys = [...this.objects.keys()]
			.filter((key) => key.startsWith(prefix))
			.sort();
		const from = Number(query.get("continuation-token") ?? "0");
		const page = keys.slice(from, from + this.pageSize);
		const more = from + page.length < keys.length;
		const contents = page
			.map((key) => {
				const bytes = this.objects.get(key) ?? new Uint8Array();
				return `<Contents><Key>${escapeXml(key)}</Key><ETag>&quot;${md5(bytes)}&quot;</ETag><Size>${bytes.length}</Size></Contents>`;
			})
			.join("");
		return xml(
			200,
			`<ListBucketResult><IsTruncated>${more}</IsTruncated>${contents}${more ? `<NextContinuationToken>${from + page.length}</NextContinuationToken>` : ""}</ListBucketResult>`,
		);
	}
}

function xml(status: number, body: string): Response {
	return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
		status,
		headers: { "content-type": "application/xml" },
	});
}

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
