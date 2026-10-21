import { NodePs, type Ps } from "webappwiz/system";
import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import { z } from "zod";
import type { AwsCredentials } from "./aws-sign";

/**
 * Finds the credentials to sign with, the way the AWS CLI would, so splates
 * keeps no AWS secret of its own: the environment's `AWS_ACCESS_KEY_ID` and
 * `AWS_SECRET_ACCESS_KEY` first; then whatever `aws configure
 * export-credentials` gives, which is a profile, SSO or a role; then the
 * Pulumi ESC environment `splates/aws` of the user's Pulumi organization,
 * when it is there, which is how a Mac with no AWS profile signs in; then,
 * on an EC2 box, its instance role through IMDSv2. Temporary ones are kept
 * until shortly before they run out.
 */
export class AwsCredentialSource {
	private readonly ps: Ps;
	private readonly fetch: typeof globalThis.fetch;
	private readonly wall: WallClock;
	private held: { credentials: AwsCredentials; until: number } | null = null;

	constructor(opts: AwsCredentialSourceOptions = {}) {
		this.ps = opts.ps ?? new NodePs();
		this.fetch = opts.fetch ?? globalThis.fetch;
		this.wall = opts.wall ?? new SystemWallClock();
	}

	/** The region the environment names, or us-east-1. */
	region(): string {
		return (
			this.ps.env("AWS_REGION") ??
			this.ps.env("AWS_DEFAULT_REGION") ??
			"us-east-1"
		);
	}

	/** The credentials to sign with now, or null when none of the places has any. */
	async credentials(): Promise<AwsCredentials | null> {
		const env = this.fromEnv();
		if (env !== null) {
			return env;
		}
		if (this.held !== null && this.wall.now() < this.held.until) {
			return this.held.credentials;
		}
		const found =
			(await this.fromCli()) ??
			(await this.fromEsc()) ??
			(await this.fromInstance());
		this.held = found;
		return found?.credentials ?? null;
	}

	private fromEnv(): AwsCredentials | null {
		const id = this.ps.env("AWS_ACCESS_KEY_ID");
		const secret = this.ps.env("AWS_SECRET_ACCESS_KEY");
		if (!id || !secret) {
			return null;
		}
		const token = this.ps.env("AWS_SESSION_TOKEN");
		return {
			accessKeyId: id,
			secretAccessKey: secret,
			...(token ? { sessionToken: token } : {}),
		};
	}

	private async fromCli(): Promise<Held | null> {
		const ran = await this.ps
			.spawnCapture([
				"aws",
				"configure",
				"export-credentials",
				"--format",
				"process",
			])
			.catch(() => null);
		if (ran === null || ran.exitCode !== 0) {
			return null;
		}
		try {
			const parsed = Exported.safeParse(JSON.parse(ran.stdout));
			return parsed.success ? this.heldOf(parsed.data) : null;
		} catch {
			return null;
		}
	}

	private async fromEsc(): Promise<Held | null> {
		const org = await this.pulumiOrg();
		if (org === null) {
			return null;
		}
		const opened = await this.capture([
			"pulumi",
			"env",
			"open",
			`${org}/${ESC_ENVIRONMENT}`,
			"--format",
			"json",
		]);
		if (opened === null) {
			return null;
		}
		try {
			const parsed = Opened.safeParse(JSON.parse(opened));
			if (!parsed.success) {
				return null;
			}
			const vars = parsed.data.environmentVariables;
			return {
				credentials: {
					accessKeyId: vars.AWS_ACCESS_KEY_ID,
					secretAccessKey: vars.AWS_SECRET_ACCESS_KEY,
					...(vars.AWS_SESSION_TOKEN === undefined
						? {}
						: { sessionToken: vars.AWS_SESSION_TOKEN }),
				},
				// The environment logs in for an hour and prints no expiry.
				until: this.wall.now() + ESC_LOGIN.ms - RENEW_BEFORE.ms,
			};
		} catch {
			return null;
		}
	}

	/** The Pulumi organization environments live in: the default one, else the user's own; null when Pulumi is missing or logged out. */
	private async pulumiOrg(): Promise<string | null> {
		const def = (await this.capture(["pulumi", "org", "get-default"]))?.trim();
		if (def) {
			return def;
		}
		const who = await this.capture(["pulumi", "whoami", "--json"]);
		try {
			const parsed = Whoami.safeParse(JSON.parse(who ?? ""));
			return parsed.success ? parsed.data.user : null;
		} catch {
			return null;
		}
	}

	/** `argv`'s output, or null when it fails or will not run. */
	private async capture(argv: string[]): Promise<string | null> {
		return this.ps.spawnCapture(argv).then(
			({ exitCode, stdout }) => (exitCode === 0 ? stdout : null),
			() => null,
		);
	}

	private async fromInstance(): Promise<Held | null> {
		try {
			const token = await this.imds("PUT", "/latest/api/token", {
				"X-aws-ec2-metadata-token-ttl-seconds": "300",
			});
			const headers = { "X-aws-ec2-metadata-token": token };
			const role = (
				await this.imds(
					"GET",
					"/latest/meta-data/iam/security-credentials/",
					headers,
				)
			)
				.split("\n")[0]
				?.trim();
			if (!role) {
				return null;
			}
			const body = await this.imds(
				"GET",
				`/latest/meta-data/iam/security-credentials/${role}`,
				headers,
			);
			const parsed = InstanceRole.safeParse(JSON.parse(body));
			return parsed.success
				? this.heldOf({
						AccessKeyId: parsed.data.AccessKeyId,
						SecretAccessKey: parsed.data.SecretAccessKey,
						SessionToken: parsed.data.Token,
						Expiration: parsed.data.Expiration,
					})
				: null;
		} catch {
			// Not on an EC2 box: nothing answers at the metadata address.
			return null;
		}
	}

	private async imds(
		method: string,
		path: string,
		headers: Record<string, string>,
	): Promise<string> {
		const response = await this.fetch(`http://169.254.169.254${path}`, {
			method,
			headers,
			signal: AbortSignal.timeout(IMDS_PATIENCE.ms),
		});
		if (!response.ok) {
			throw new Error(`the metadata service answered ${response.status}`);
		}
		return response.text();
	}

	private heldOf(exported: z.infer<typeof Exported>): Held {
		const expires =
			exported.Expiration === undefined
				? Number.POSITIVE_INFINITY
				: Date.parse(exported.Expiration) - RENEW_BEFORE.ms;
		return {
			credentials: {
				accessKeyId: exported.AccessKeyId,
				secretAccessKey: exported.SecretAccessKey,
				...(exported.SessionToken === undefined
					? {}
					: { sessionToken: exported.SessionToken }),
			},
			until: expires,
		};
	}
}

/** What an `AwsCredentialSource` runs on; the real ones by default. */
export interface AwsCredentialSourceOptions {
	/** The process seam, which holds the environment and runs the AWS CLI. */
	ps?: Ps;
	fetch?: typeof globalThis.fetch;
	wall?: WallClock;
}

interface Held {
	credentials: AwsCredentials;
	/** Epoch milliseconds to ask again at. */
	until: number;
}

/** How long to wait for the metadata address, which answers at once on a box and never elsewhere. */
const IMDS_PATIENCE = Duration.secs(1);

/** How long before temporary credentials run out they are asked for again. */
const RENEW_BEFORE = Duration.mins(5);

/** The Pulumi ESC environment, by project and name, that `coordinator-access` makes. */
const ESC_ENVIRONMENT = "splates/aws";

/** How long the environment's OIDC login lasts. */
const ESC_LOGIN = Duration.mins(60);

/** What `pulumi env open --format json` prints of the environment's variables. */
const Opened = z.object({
	environmentVariables: z.object({
		AWS_ACCESS_KEY_ID: z.string(),
		AWS_SECRET_ACCESS_KEY: z.string(),
		AWS_SESSION_TOKEN: z.string().optional(),
	}),
});

const Whoami = z.object({ user: z.string() });

/** What `aws configure export-credentials --format process` prints. */
const Exported = z.object({
	AccessKeyId: z.string(),
	SecretAccessKey: z.string(),
	SessionToken: z.string().optional(),
	Expiration: z.string().optional(),
});

/** What the metadata service answers for a role. */
const InstanceRole = z.object({
	AccessKeyId: z.string(),
	SecretAccessKey: z.string(),
	Token: z.string(),
	Expiration: z.string(),
});
