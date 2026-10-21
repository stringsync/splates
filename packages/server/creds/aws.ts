import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AwsCredentials } from "./imds";

/** What signs requests to AWS, and where: the instance role's or a person's own keys. */
export interface AwsSource {
	credentials(): Promise<AwsCredentials>;
	region(): Promise<string>;
}

export interface AwsKeysOptions {
	env?: Record<string, string | undefined>;
	/** Where `~/.aws` is, for a test. */
	home?: string;
}

/**
 * A person's own AWS keys, as the AWS CLI finds them: `AWS_ACCESS_KEY_ID` and
 * `AWS_SECRET_ACCESS_KEY` (with `AWS_SESSION_TOKEN`), else the `AWS_PROFILE`
 * (default `default`) of `~/.aws/credentials`. The region is `AWS_REGION`,
 * `AWS_DEFAULT_REGION` or the profile's in `~/.aws/config`.
 */
export class AwsKeys implements AwsSource {
	private readonly env: Record<string, string | undefined>;
	private readonly home: string;

	constructor(opts: AwsKeysOptions = {}) {
		this.env = opts.env ?? process.env;
		this.home = opts.home ?? homedir();
	}

	/** Whether keys are set, so a request can be signed with them. */
	async available(): Promise<boolean> {
		try {
			await this.credentials();
			return true;
		} catch {
			return false;
		}
	}

	async credentials(): Promise<AwsCredentials> {
		const { AWS_ACCESS_KEY_ID: id, AWS_SECRET_ACCESS_KEY: secret } = this.env;
		if (id && secret) {
			return keys(id, secret, this.env.AWS_SESSION_TOKEN);
		}
		const profile = await this.section("credentials", this.profile());
		if (profile.aws_access_key_id && profile.aws_secret_access_key) {
			return keys(
				profile.aws_access_key_id,
				profile.aws_secret_access_key,
				profile.aws_session_token,
			);
		}
		throw new Error(
			"no AWS keys: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or a profile in ~/.aws/credentials",
		);
	}

	async region(): Promise<string> {
		const set = this.env.AWS_REGION ?? this.env.AWS_DEFAULT_REGION;
		if (set) {
			return set;
		}
		const name = this.profile();
		const config = await this.section(
			"config",
			name === "default" ? name : `profile ${name}`,
		);
		if (!config.region) {
			throw new Error("no AWS region: set AWS_REGION");
		}
		return config.region;
	}

	private profile(): string {
		return this.env.AWS_PROFILE || "default";
	}

	private async section(
		file: "credentials" | "config",
		name: string,
	): Promise<Record<string, string>> {
		let text: string;
		try {
			text = await readFile(join(this.home, ".aws", file), "utf8");
		} catch {
			return {};
		}
		const found: Record<string, string> = {};
		let inside = false;
		for (const raw of text.split("\n")) {
			const line = raw.trim();
			const header = /^\[(.*)\]$/.exec(line);
			if (header) {
				inside = header[1]?.trim() === name;
			} else if (inside && line !== "" && !/^[#;]/.test(line)) {
				const at = line.indexOf("=");
				if (at > 0) {
					found[line.slice(0, at).trim()] = line.slice(at + 1).trim();
				}
			}
		}
		return found;
	}
}

function keys(id: string, secret: string, token?: string): AwsCredentials {
	return {
		accessKeyId: id,
		secretAccessKey: secret,
		sessionToken: token ?? "",
		expiresAt: Number.POSITIVE_INFINITY,
	};
}
