import type { SecretStore } from "webappwiz/creds";
import { credentialName } from "webappwiz/creds";
import { z } from "zod";
import type { AwsSource } from "./aws";
import { Imds } from "./imds";
import { signed } from "./sigv4";

const PARAMETER = z.object({ Parameter: z.object({ Value: z.string() }) });
const BY_PATH = z.object({
	Parameters: z.array(z.object({ Name: z.string() })),
	NextToken: z.string().optional(),
});
const FAILURE = z.object({ __type: z.string().optional() });

export interface SsmSecretStoreOptions {
	/** Defaults to the instance's own region. */
	region?: string;
	/** What signs the requests; defaults to the instance role's through IMDSv2. */
	source?: AwsSource;
	fetch?: typeof fetch;
	/** Where SSM is reached, such as a fake in a test. */
	endpoint?: string;
	now?: () => number;
}

/**
 * Secrets kept as `SecureString` parameters in AWS Systems Manager Parameter
 * Store, under `prefix` (`/splates/device/`), signed with the credentials the
 * EC2 instance role gives, so the box keeps no secret on disk. Standard tier
 * and the default KMS key cost nothing.
 *
 * The role needs this policy, with `kms:Decrypt` on the default key:
 *
 * ```json
 * {
 *   "Version": "2012-10-17",
 *   "Statement": [
 *     {
 *       "Effect": "Allow",
 *       "Action": [
 *         "ssm:GetParameter",
 *         "ssm:GetParametersByPath",
 *         "ssm:PutParameter",
 *         "ssm:DeleteParameter"
 *       ],
 *       "Resource": "arn:aws:ssm:*:*:parameter/splates/*"
 *     },
 *     { "Effect": "Allow", "Action": "kms:Decrypt", "Resource": "*" }
 *   ]
 * }
 * ```
 */
export class SsmSecretStore implements SecretStore {
	readonly label: string;
	private readonly prefix: string;
	private readonly source: AwsSource;
	private readonly fetch: typeof fetch;
	private readonly now: () => number;
	private region?: string;
	private readonly endpoint?: string;

	constructor(prefix: string, opts: SsmSecretStoreOptions = {}) {
		this.prefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
		this.label = `AWS Parameter Store ${this.prefix}`;
		this.fetch = opts.fetch ?? fetch;
		this.now = opts.now ?? Date.now;
		this.source = opts.source ?? new Imds({ fetch: this.fetch, now: this.now });
		this.region = opts.region;
		this.endpoint = opts.endpoint;
	}

	async get(name: string): Promise<string | undefined> {
		const reply = await this.call("GetParameter", {
			Name: this.parameter(name),
			WithDecryption: true,
		});
		return reply ? PARAMETER.parse(reply).Parameter.Value : undefined;
	}

	async set(name: string, value: string): Promise<void> {
		await this.call("PutParameter", {
			Name: this.parameter(name),
			Value: value,
			Type: "SecureString",
			Overwrite: true,
			Tier: "Standard",
		});
	}

	async delete(name: string): Promise<boolean> {
		return (
			(await this.call("DeleteParameter", { Name: this.parameter(name) })) !==
			undefined
		);
	}

	async names(): Promise<string[]> {
		const names: string[] = [];
		let next: string | undefined;
		do {
			const reply = await this.call("GetParametersByPath", {
				Path: this.prefix.slice(0, -1),
				Recursive: false,
				MaxResults: 10,
				...(next ? { NextToken: next } : {}),
			});
			const page = BY_PATH.parse(reply);
			for (const { Name } of page.Parameters) {
				names.push(Name.slice(this.prefix.length));
			}
			next = page.NextToken;
		} while (next);
		return names.sort();
	}

	private parameter(name: string): string {
		return this.prefix + credentialName(name);
	}

	/** The reply to `target`, or undefined when the parameter does not exist. */
	private async call(
		target: string,
		payload: Record<string, unknown>,
	): Promise<unknown> {
		this.region ??= await this.source.region();
		const region = this.region;
		const url = new URL(
			this.endpoint ?? `https://ssm.${region}.amazonaws.com/`,
		);
		const body = JSON.stringify(payload);
		const response = await this.fetch(url, {
			method: "POST",
			body,
			headers: signed({
				url,
				service: "ssm",
				region,
				body,
				headers: {
					"content-type": "application/x-amz-json-1.1",
					"x-amz-target": `AmazonSSM.${target}`,
				},
				credentials: await this.source.credentials(),
				at: new Date(this.now()),
			}),
		});
		const text = await response.text();
		if (response.ok) {
			return text ? JSON.parse(text) : {};
		}
		const type = FAILURE.safeParse(safeJson(text)).data?.__type ?? "";
		if (type.endsWith("ParameterNotFound")) {
			return undefined;
		}
		throw new Error(
			`Parameter Store ${target} failed: ${response.status} ${type}`.trim(),
		);
	}
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
