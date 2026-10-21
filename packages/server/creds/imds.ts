import { z } from "zod";

const ENDPOINT = "http://169.254.169.254";

/** Refresh credentials this long before they expire. */
const REFRESH_BEFORE_MS = 5 * 60 * 1000;

const ROLE_CREDENTIALS = z.object({
	AccessKeyId: z.string(),
	SecretAccessKey: z.string(),
	Token: z.string(),
	Expiration: z.string(),
});

/** What signs a request to AWS. */
export interface AwsCredentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken: string;
	/** Epoch milliseconds. */
	expiresAt: number;
}

export interface ImdsOptions {
	fetch?: typeof fetch;
	/** Base URL of the metadata service. */
	endpoint?: string;
	now?: () => number;
}

/**
 * The credentials an EC2 instance role gives, read through IMDSv2 (a session
 * token first, which a hop limit of 1 keeps off any container on the box) and
 * read again once they are within five minutes of expiring.
 */
export class Imds {
	private readonly fetch: typeof fetch;
	private readonly endpoint: string;
	private readonly now: () => number;
	private cached?: AwsCredentials;
	private pending?: Promise<AwsCredentials>;

	constructor(opts: ImdsOptions = {}) {
		this.fetch = opts.fetch ?? fetch;
		this.endpoint = opts.endpoint ?? ENDPOINT;
		this.now = opts.now ?? Date.now;
	}

	/** Whether the metadata service answers with a token: this runs on EC2. */
	async available(): Promise<boolean> {
		try {
			await this.token();
			return true;
		} catch {
			return false;
		}
	}

	/** The role's credentials, fresh enough to sign with. */
	credentials(): Promise<AwsCredentials> {
		if (this.cached && this.cached.expiresAt - this.now() > REFRESH_BEFORE_MS) {
			return Promise.resolve(this.cached);
		}
		this.pending ??= this.load().finally(() => {
			this.pending = undefined;
		});
		return this.pending;
	}

	/** The region the instance runs in. */
	async region(): Promise<string> {
		return this.get("/latest/meta-data/placement/region", await this.token());
	}

	private async load(): Promise<AwsCredentials> {
		const token = await this.token();
		const base = "/latest/meta-data/iam/security-credentials/";
		const role = (await this.get(base, token)).split("\n")[0]?.trim();
		if (!role) {
			throw new Error("this instance has no IAM role attached");
		}
		const parsed = ROLE_CREDENTIALS.parse(
			JSON.parse(await this.get(base + role, token)),
		);
		this.cached = {
			accessKeyId: parsed.AccessKeyId,
			secretAccessKey: parsed.SecretAccessKey,
			sessionToken: parsed.Token,
			expiresAt: Date.parse(parsed.Expiration),
		};
		return this.cached;
	}

	private async token(): Promise<string> {
		const response = await this.fetch(`${this.endpoint}/latest/api/token`, {
			method: "PUT",
			headers: { "x-aws-ec2-metadata-token-ttl-seconds": "300" },
			signal: AbortSignal.timeout(2000),
		});
		if (!response.ok) {
			throw new Error(`IMDS token request failed: ${response.status}`);
		}
		return response.text();
	}

	private async get(path: string, token: string): Promise<string> {
		const response = await this.fetch(this.endpoint + path, {
			headers: { "x-aws-ec2-metadata-token": token },
			signal: AbortSignal.timeout(2000),
		});
		if (!response.ok) {
			throw new Error(`IMDS ${path} failed: ${response.status}`);
		}
		return response.text();
	}
}
