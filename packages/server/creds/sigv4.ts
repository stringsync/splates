import { createHash, createHmac } from "node:crypto";
import type { AwsCredentials } from "./imds";

const sha256 = (data: string) =>
	createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) =>
	createHmac("sha256", key).update(data).digest();

/**
 * The headers that sign a POST of `body` to `url` for `service` in `region`
 * with AWS Signature Version 4, `headers` being the others the request sends.
 */
export function signed(opts: {
	url: URL;
	service: string;
	region: string;
	body: string;
	headers: Record<string, string>;
	credentials: AwsCredentials;
	at: Date;
}): Record<string, string> {
	const { url, service, region, body, credentials } = opts;
	const stamp = opts.at.toISOString().replace(/[-:]|\.\d{3}/g, "");
	const day = stamp.slice(0, 8);
	const headers: Record<string, string> = {
		...opts.headers,
		host: url.host,
		"x-amz-date": stamp,
		...(credentials.sessionToken
			? { "x-amz-security-token": credentials.sessionToken }
			: {}),
	};
	const names = Object.keys(headers)
		.map((name) => name.toLowerCase())
		.sort();
	const lowered = Object.fromEntries(
		Object.entries(headers).map(([name, value]) => [
			name.toLowerCase(),
			value.trim(),
		]),
	);
	const canonical = [
		"POST",
		url.pathname,
		url.search.slice(1),
		...names.map((name) => `${name}:${lowered[name]}`),
		"",
		names.join(";"),
		sha256(body),
	].join("\n");
	const scope = `${day}/${region}/${service}/aws4_request`;
	const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join(
		"\n",
	);
	const key = hmac(
		hmac(
			hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region),
			service,
		),
		"aws4_request",
	);
	const signature = createHmac("sha256", key).update(toSign).digest("hex");
	return {
		...headers,
		authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
	};
}
