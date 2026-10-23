import { FlyCloud } from "../cloud";
import type { StepField } from "./fields";
import type { SetupMachine } from "./setup";

/** What a step that reads or makes machines in the cloud `uses`: its token. */
export const CLOUD_USES: readonly string[] = [new FlyCloud().token.cred];

/** The cloud splates makes runners in on this machine, named for Fly during the runner migration, reading its token from the machine's device creds. */
export function cloudOf(machine: SetupMachine): FlyCloud {
	return new FlyCloud({
		store: machine.device,
		...(machine.fetch === undefined ? {} : { fetch: machine.fetch }),
	});
}

/** The cloud's token as the page asks for it, pasted there and saved for the device. */
export function cloudTokenFields(machine: SetupMachine): StepField[] {
	const { token } = cloudOf(machine);
	return [
		{ kind: "cred", name: token.cred, label: token.label, help: token.help },
	];
}

/** Whether the device keeps a token the cloud takes. */
export function cloudTokenAccepted(machine: SetupMachine): Promise<boolean> {
	return cloudOf(machine).accepted();
}

/** Throws the cloud's own words when it does not take the token kept. */
export async function requireCloudToken(machine: SetupMachine): Promise<void> {
	const cloud = cloudOf(machine);
	if (!(await cloud.accepted())) {
		throw new Error(cloud.token.refused);
	}
}
