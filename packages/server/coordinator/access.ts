import type { Ps } from "webappwiz/system";
import { z } from "zod";

/**
 * The Pulumi ESC environment, by project and name, that signs `pulumi up`
 * and splates in to AWS over OIDC, as the stack's `environment:` imports it.
 */
export const ACCESS_ENVIRONMENT = "splates/aws";

/** The role `infra/pulumi-access.yaml` makes, which the environment assumes. */
export const ACCESS_ROLE = "splates-pulumi";

/** Where AWS CloudShell opens, signed in as the user is in the console. */
export const CLOUDSHELL_URL = "https://console.aws.amazon.com/cloudshell/home";

/** Where CloudShell fetches the template from: trunk's, which a dev checkout and every release share. */
const TEMPLATE_URL =
	"https://raw.githubusercontent.com/stringsync/splates/main/packages/server/infra/pulumi-access.yaml";

/**
 * The one line the user pastes into AWS CloudShell: it makes the OIDC
 * provider and the role from the checked-in template, trusting `org`'s
 * environments, and prints the account id the page then asks for.
 */
export function accessCommand(org: string): string {
	return [
		`curl -fsSL ${TEMPLATE_URL} -o splates-pulumi.yaml`,
		`aws cloudformation deploy --stack-name ${ACCESS_ROLE} --template-file splates-pulumi.yaml --capabilities CAPABILITY_NAMED_IAM --parameter-overrides PulumiOrg=${org}`,
		"aws sts get-caller-identity --query Account --output text",
	].join(" && ");
}

/** The environment's definition: an hour's OIDC login as the role in `account`, given to the AWS CLI and `pulumi up` as variables. */
export function accessDefinition(account: string): string {
	return `values:
  aws:
    login:
      fn::open::aws-login:
        oidc:
          duration: 1h
          roleArn: arn:aws:iam::${account}:role/${ACCESS_ROLE}
          sessionName: splates
  environmentVariables:
    AWS_ACCESS_KEY_ID: \${aws.login.accessKeyId}
    AWS_SECRET_ACCESS_KEY: \${aws.login.secretAccessKey}
    AWS_SESSION_TOKEN: \${aws.login.sessionToken}
`;
}

/** The Pulumi organization environments go in: the default one, else the user's own; null when Pulumi is not logged in. */
export async function pulumiOrg(ps: Ps): Promise<string | null> {
	const def = await capture(ps, ["pulumi", "org", "get-default"]);
	if (def !== null && def.trim() !== "") {
		return def.trim();
	}
	const who = await capture(ps, ["pulumi", "whoami", "--json"]);
	if (who === null) {
		return null;
	}
	try {
		const parsed = Whoami.safeParse(JSON.parse(who));
		return parsed.success ? parsed.data.user : null;
	} catch {
		return null;
	}
}

/** `ACCESS_ENVIRONMENT` in `org`, as `pulumi env` names it. */
export function accessEnvironmentIn(org: string): string {
	return `${org}/${ACCESS_ENVIRONMENT}`;
}

/** Whether `org`'s environment is there, as `pulumi env get` finds it. */
export async function accessEnvironmentExists(
	ps: Ps,
	org: string,
): Promise<boolean> {
	return (
		(await capture(ps, ["pulumi", "env", "get", accessEnvironmentIn(org)])) !==
		null
	);
}

/**
 * Makes `org`'s environment, or rewrites its definition when it is there,
 * to sign in as the role in `account`. Throws with what Pulumi said.
 */
export async function writeAccessEnvironment(
	ps: Ps,
	org: string,
	account: string,
): Promise<void> {
	const name = accessEnvironmentIn(org);
	const verb = (await accessEnvironmentExists(ps, org)) ? "edit" : "init";
	const ran = await ps.spawnCapture(["pulumi", "env", verb, name, "-f", "-"], {
		stdin: accessDefinition(account),
	});
	if (ran.exitCode !== 0) {
		throw new Error(
			`\`pulumi env ${verb} ${name}\` failed: ${(ran.stderr || ran.stdout).trim()}`,
		);
	}
}

/** Whether AWS takes the sign-in `org`'s environment gives, run as `pulumi up` would be. */
export async function accessEnvironmentSignsIn(
	ps: Ps,
	org: string,
): Promise<boolean> {
	return (
		(await capture(ps, [
			"pulumi",
			"env",
			"run",
			accessEnvironmentIn(org),
			"--",
			"aws",
			"sts",
			"get-caller-identity",
		])) !== null
	);
}

/**
 * The ARN the AWS CLI here signs in as, from its own profile or environment
 * rather than the ESC environment, as `pulumi up` signs in without one; null
 * when it signs in as no one.
 */
export async function profileCaller(ps: Ps): Promise<string | null> {
	const found = await capture(ps, [
		"aws",
		"sts",
		"get-caller-identity",
		"--output",
		"json",
	]);
	if (found === null) {
		return null;
	}
	try {
		const parsed = CallerIdentity.safeParse(JSON.parse(found));
		return parsed.success ? parsed.data.Arn : null;
	} catch {
		return null;
	}
}

const Whoami = z.object({ user: z.string() });

const CallerIdentity = z.object({ Arn: z.string() });

/** `argv`'s output, or null when it fails or will not run. */
async function capture(ps: Ps, argv: string[]): Promise<string | null> {
	return ps.spawnCapture(argv).then(
		({ exitCode, stdout }) => (exitCode === 0 ? stdout : null),
		() => null,
	);
}
