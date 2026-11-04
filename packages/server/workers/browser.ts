import type { MachineReading } from "./load";

/** CPU and memory shares, and degrees, past which each is yellow, then red. */
export const SHARE = { warning: 0.8, destructive: 0.9 };
export const DEGREES = { warning: 80, destructive: 95 };

/**
 * Whether the machine is working hard enough that agents may slow down, the
 * page's Busy and what `splates machine` says: CPU or memory red, or the
 * hottest sensor red.
 */
export function strained(
	reading: Pick<MachineReading, "cpu" | "memory" | "temperature">,
): boolean {
	return (
		reading.cpu >= SHARE.destructive ||
		reading.memory >= SHARE.destructive ||
		(reading.temperature !== null && reading.temperature >= DEGREES.destructive)
	);
}
