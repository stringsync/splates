import type { SplatesDeps } from "@splates/server/server";
import {
	Machine,
	type MachineReading,
	OsSensors,
	strained,
} from "@splates/server/workers";
import { Duration, sleep } from "core/time";

/** How long CPU is measured over, as a share since the reading before. */
const SAMPLE = Duration.secs(1);

/** What `printMachine` is asked for. */
export interface MachineOptions {
	/** Prints the reading as JSON rather than a line. */
	json: boolean;
}

/**
 * `splates machine`: this machine's reading, taken here so it needs no server,
 * and whether it is busy.
 */
export async function printMachine(
	ctx: SplatesDeps,
	opts: MachineOptions,
): Promise<void> {
	const machine = new Machine(new OsSensors(ctx.fs));
	await sleep(SAMPLE);
	const reading = await machine.read();
	const busy = strained(reading);
	ctx.log.info(
		opts.json
			? JSON.stringify({ busy, ...reading })
			: `${busy ? "busy" : "not busy"}: ${readingLine(reading)}`,
	);
}

function readingLine(reading: MachineReading): string {
	const temperature =
		reading.temperature === null
			? ""
			: `, ${Math.round(reading.temperature)}°C`;
	return `CPU ${percent(reading.cpu)}, memory ${percent(reading.memory)}, load ${reading.load.toFixed(1)} on ${reading.cores} cores${temperature}`;
}

function percent(share: number): string {
	return `${Math.round(share * 100)}%`;
}
