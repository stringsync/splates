import * as pulumi from "@pulumi/pulumi";

/**
 * The secret in environment variable `name`, which splates sets on each
 * `pulumi` run from the creds store, so a replaced cred reaches the next run
 * and no secret is written into the stack's config.
 */
export function envSecret(name: string): pulumi.Output<string> {
	const value = process.env[name];
	if (value === undefined || value === "") {
		throw new Error(
			`${name} is not set: splates sets it on each pulumi run from its creds store, so run through the setup's Next, or \`splates server infra init\` to request it`,
		);
	}
	return pulumi.secret(value);
}
