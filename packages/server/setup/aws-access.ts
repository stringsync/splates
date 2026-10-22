import {
	ACCESS_ENVIRONMENT,
	ACCESS_ROLE,
	accessCommand,
	accessEnvironmentIn,
	accessEnvironmentSignsIn,
	CLOUDSHELL_URL,
	CoordinatorBox,
	coordinatorMoved,
	profileCaller,
	pulumiOrg,
	writeAccessEnvironment,
} from "../coordinator";
import { importEnvironment } from "../infra/init";
import { cloudAccepted } from "./cloud";
import type { SetupStep } from "./setup";

/** What the access step hands its page: the CloudShell line to paste, filled in for the user's Pulumi organization. */
export interface AwsAccess extends Record<string, unknown> {
	/** Where AWS CloudShell opens. */
	cloudShell: string;
	/** The line that makes the role and prints the account id. */
	command: string;
	/** The ESC environment Next makes, as `pulumi env` names it. */
	environment: string;
}

/** Why the step is not done yet. */
const ACCESS_MISSING =
	"AWS takes no sign-in found here: paste the account id CloudShell printed, or `aws configure` a profile, then press Next.";

/** How the user moves from a profile onto ESC, on this step's page. */
const PUT_RIGHT =
	"To sign in over ESC instead, paste the CloudShell line on this step's Setup page into AWS CloudShell, then give the page the account id it prints and press Next.";

/** The field the account id goes in. */
const ACCOUNT = "account";

/**
 * How `pulumi up` and splates sign in to AWS, with no long-lived key: a
 * line in AWS CloudShell makes an OIDC provider for Pulumi Cloud and the
 * role `splates-pulumi`, then Next makes the Pulumi ESC environment that
 * assumes it for an hour at a time and has the infra stack import it.
 * An AWS profile here does as well. `after` is the Pulumi login, whose
 * organization the role trusts.
 */
export function awsAccessStep(after: readonly SetupStep[]): SetupStep {
	return {
		id: "coordinator-access",
		title: "Sign in to AWS",
		why: "Pulumi and splates sign in to AWS through a role for an hour at a time, so no AWS key is kept anywhere.",
		user: `1. Open AWS CloudShell, signed in as you\n2. Paste this command and press Enter. It makes the role \`${ACCESS_ROLE}\` and prints your account id\n3. Enter the account id and press Next\n4. Once it signs in, delete any root access keys (IAM › Security credentials)\n\nRather use an AWS profile? Run \`aws configure\`, leave the id empty and press Next.`,
		agent: `Have the user open AWS CloudShell, paste the line the step's page shows (it deploys the CloudFormation stack \`${ACCESS_ROLE}\` from \`packages/server/infra/pulumi-access.yaml\` and prints the account id), and give the account id to the page, whose Next makes the ESC environment \`<org>/${ACCESS_ENVIRONMENT}\` and has the infra stack import it. When the account already has an OIDC provider for \`api.pulumi.com/oidc\`, the deploy fails: add \`ProviderArn=<its arn>\` to the line's overrides. \`pulumi env run <org>/${ACCESS_ENVIRONMENT} -- aws sts get-caller-identity\` checks it. Then have them delete any root access keys (IAM, Security credentials). The fallback is an AWS profile (\`aws configure\`, or \`aws sso login\`): the step is done when either signs in, and while only a profile does, its page says so, warning when the profile is the root user's key.`,
		optional: true,
		after,
		fields: [
			{
				kind: "text",
				name: ACCOUNT,
				label: "AWS account id",
				placeholder: "123456789012",
				optional: true,
			},
		],
		doing: "Making the Pulumi ESC environment…",
		// A profile makes the step done without the environment, so say when it is the one signing in.
		warning: async (machine) => {
			const { ps } = machine;
			if (ps === undefined) {
				return null;
			}
			const org = await pulumiOrg(ps);
			if (org !== null && (await accessEnvironmentSignsIn(ps, org))) {
				return null;
			}
			const caller = await profileCaller(ps);
			if (caller === null) {
				return null;
			}
			return caller.endsWith(":root")
				? `An AWS profile here signs in instead of Pulumi ESC, with the root user's access key, which can do anything in the account and never runs out. ${PUT_RIGHT} Then delete the key in the console (IAM, Security credentials).`
				: `An AWS profile here signs in instead of Pulumi ESC, as \`${caller}\`. ${PUT_RIGHT}`;
		},
		data: async (machine): Promise<AwsAccess | null> => {
			const org = machine.ps && (await pulumiOrg(machine.ps));
			return org
				? {
						cloudShell: CLOUDSHELL_URL,
						command: accessCommand(org),
						environment: accessEnvironmentIn(org),
					}
				: null;
		},
		submit: async (machine, answers) => {
			const account = String(answers[ACCOUNT] ?? "").trim();
			if (account === "") {
				return;
			}
			if (!/^\d{12}$/.test(account)) {
				throw new Error(
					"An AWS account id is 12 digits, as CloudShell's last line prints.",
				);
			}
			const { ps } = machine;
			const org = ps && (await pulumiOrg(ps));
			if (!ps || !org) {
				throw new Error("Pulumi is not logged in here: `pulumi login` first.");
			}
			await writeAccessEnvironment(ps, org, account);
			const infra = await new CoordinatorBox({
				ps,
				fs: machine.fs,
				home: machine.home,
			}).infra();
			if (infra !== null) {
				await importEnvironment(
					machine.fs,
					`${infra.dir}/Pulumi.${infra.stack ?? "prod"}.yaml`,
					ACCESS_ENVIRONMENT,
				);
			}
		},
		check: async (machine) => {
			if (await coordinatorMoved(machine)) {
				return true;
			}
			// With no way to run the AWS CLI here, there is no sign-in to find.
			const { ps } = machine;
			if (ps === undefined) {
				return false;
			}
			if (await cloudAccepted(machine)) {
				return true;
			}
			const org = await pulumiOrg(ps);
			return org !== null && (await accessEnvironmentSignsIn(ps, org));
		},
		notDone: ACCESS_MISSING,
		undo: {
			removes: async () => [],
			leaves: async () => [
				`Your AWS sign-in: the role, which \`aws cloudformation delete-stack --stack-name ${ACCESS_ROLE}\` in CloudShell removes, and the ESC environment, which \`pulumi env rm <org>/${ACCESS_ENVIRONMENT}\` removes; or the profile. splates only reads them.`,
			],
			run: async () => {},
		},
	};
}
