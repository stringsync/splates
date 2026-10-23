import { Credentials, Environment } from "webappwiz/creds";
import { Disposer } from "webappwiz/disposable";
import { NodePs, type Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { splatesHome } from "../models";
import { RunnerServer } from "./runner-server";

/** The env a runner reads how long it stands idle in, in milliseconds, before it exits and its machine stops. */
export const RUNNER_IDLE = "SPLATES_RUNNER_IDLE_MS";

/**
 * Serves the image's job channel until the hosting platform stops it, or
 * until no job has run for the idle tail, when it returns for the process to
 * exit and the machine to stop.
 */
export async function runnerServe(opts: RunnerServeOptions): Promise<void> {
	const ps = opts.ps ?? new NodePs();
	// The container's hosting platform supplies this secret, never a person's shell.
	const secret = await new Credentials([new Environment({ ps })]).require(
		"SPLATES_RUNNER_SECRET",
	);
	const idle = Number(ps.env(RUNNER_IDLE));
	let leave: () => void = () => {};
	const server = new RunnerServer(ps, {
		...(Number.isFinite(idle) && idle > 0
			? { idle: Duration.ms(idle), onIdle: () => leave() }
			: {}),
		secret,
		...(ps.env("SPLATES_RUNNER_ID") === undefined
			? {}
			: { id: ps.env("SPLATES_RUNNER_ID") }),
		port: opts.port,
		home: `${splatesHome(ps)}/runner`,
	});
	const signals = new Disposer();
	try {
		await new Promise<void>((resolve) => {
			leave = resolve;
			signals.use(ps.on("SIGTERM", resolve));
			signals.use(ps.on("SIGINT", resolve));
		});
	} finally {
		signals.dispose();
		await server.disposeAsync();
	}
}

/** The image's listening port and process environment. */
export interface RunnerServeOptions {
	port: number;
	ps?: Ps;
}
