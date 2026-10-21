import { CLOUD_ACCESS_MISSING, cloudAccepted } from "./cloud";
import { coordinatorMoved } from "./coordinator-move";
import type { SetupStep } from "./setup";

/**
 * How `pulumi up` and splates sign in to AWS, one step both the Cloud server
 * and the Workers areas read, so a user signs in once.
 */
export const AWS_ACCESS_STEP: SetupStep = {
	id: "coordinator-access",
	title: "Sign in to AWS",
	why: "`pulumi up` makes the server's box in your AWS account, and splates reads Parameter Store and makes cloud workers there. Both sign in the same way, so you do it once.",
	user: "Recommended: a Pulumi ESC environment with AWS OIDC login, which `pulumi up` runs under and gives no long-lived keys. Otherwise `aws configure` an AWS profile. Then press Next.",
	agent:
		"Have the user sign in to AWS: a Pulumi ESC environment with OIDC is best (`pulumi env run <env> -- aws sts get-caller-identity` checks it), an AWS profile (`aws configure`, or `aws sso login`) the fallback. The step is done when `aws sts get-caller-identity` succeeds here.",
	optional: true,
	after: [],
	check: async (machine) =>
		(await coordinatorMoved(machine)) ||
		// With no way to run the AWS CLI here, there is no sign-in to find.
		(machine.ps !== undefined && (await cloudAccepted(machine))),
	notDone: CLOUD_ACCESS_MISSING,
	undo: {
		removes: async () => [],
		leaves: async () => [
			"Your AWS sign-in, the profile or the Pulumi ESC environment: splates only reads it.",
		],
		run: async () => {},
	},
};
