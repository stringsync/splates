import type { SetupMachine } from "./setup";

const KEPT = new WeakMap<SetupMachine, Map<string, Promise<unknown>>>();

/**
 * The answer of `probe` for `key` on `machine`, run once and shared by every
 * step that asks, until `forgetProbes` says the machine may have changed.
 */
export function probed<T>(
	machine: SetupMachine,
	key: string,
	probe: () => Promise<T>,
): Promise<T> {
	let kept = KEPT.get(machine);
	if (kept === undefined) {
		kept = new Map();
		KEPT.set(machine, kept);
	}
	let answer = kept.get(key) as Promise<T> | undefined;
	if (answer === undefined) {
		answer = probe();
		kept.set(key, answer);
	}
	return answer;
}

/** Makes the next `probed` on `machine` run its probe again. */
export function forgetProbes(machine: SetupMachine): void {
	KEPT.delete(machine);
}
