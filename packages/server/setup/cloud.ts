import { type CloudProvider, machineCloud } from "../cloud";
import type { SetupMachine } from "./setup";

/** The cloud splates makes machines in on this machine: AWS, reading its sign-in from the AWS CLI or the instance role. */
export function cloudOf(machine: SetupMachine): CloudProvider {
	return machineCloud({
		store: machine.device,
		ps: machine.ps,
		...(machine.fetch === undefined ? {} : { fetch: machine.fetch }),
	});
}

/** Whether AWS takes the sign-in found here. */
export async function cloudAccepted(machine: SetupMachine): Promise<boolean> {
	return cloudOf(machine).accepted();
}

/** Throws when AWS takes no sign-in found here. */
export async function requireCloudAccess(machine: SetupMachine): Promise<void> {
	const cloud = cloudOf(machine);
	if (!(await cloud.accepted())) {
		throw new Error(CLOUD_ACCESS_MISSING);
	}
}

/** Why a step that needs the cloud is not done. */
export const CLOUD_ACCESS_MISSING =
	"AWS takes no sign-in found here: run `aws configure`, or give the box an instance role, then press Next.";
