import { JobClient, run as runJobs } from "@stringsync/splates-server/jobs";
import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";

export interface RunCommandOptions {
	cpus: number;
	memory: number;
	walltime: string;
	command: string[];
	log: Logger;
	ps: Ps;
}

/** `splates run -- <cmd>`: the command as a job of the server's scheduler, exiting with its code. */
export async function run(opts: RunCommandOptions): Promise<void> {
	const { log, ps } = opts;
	if (opts.command.length === 0) {
		throw new Error("splates run needs a command: splates run -- <cmd>");
	}
	const code = await runJobs({
		argv: opts.command,
		cpus: opts.cpus,
		...(opts.memory > 0 ? { memory: opts.memory } : {}),
		walltime: walltimeOf(opts.walltime),
		submitter: JobClient.of(ps, log),
		log,
		ps,
	});
	ps.exit(code);
}

const UNITS = { s: 1000, m: 60_000, h: 3_600_000 } as const;

function walltimeOf(text: string): Duration {
	const match = /^(\d+(?:\.\d+)?)([smh])$/.exec(text);
	if (match === null) {
		throw new Error(`--walltime ${text} is not a number and a unit, as 10m`);
	}
	return Duration.ms(Number(match[1]) * UNITS[match[2] as keyof typeof UNITS]);
}
