import type { SetupMachine, SetupStep } from "./setup";

/** Whether `step` is on the roster for this machine; a throw reading that hides it. */
export async function listed(
	step: SetupStep,
	machine: SetupMachine,
): Promise<boolean> {
	return (await step.shown?.(machine).catch(() => false)) ?? true;
}

/** A step's check, a throw turned into the problem it reports. */
export async function checked(
	step: SetupStep,
	machine: SetupMachine,
): Promise<{ done: boolean; problem: string | null }> {
	try {
		return { done: await step.check(machine), problem: null };
	} catch (error) {
		return {
			done: false,
			problem: error instanceof Error ? error.message : String(error),
		};
	}
}
