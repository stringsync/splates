import { Credentials, Environment } from "webappwiz/creds";
import { Disposer } from "webappwiz/disposable";
import { NodePs, type Ps } from "webappwiz/system";
import { splatesHome } from "../models";
import { RunnerServer } from "./runner-server";

/** Serves the image's job channel until the hosting platform stops it. */
export async function runnerServe(opts: RunnerServeOptions): Promise<void> {
	const ps = opts.ps ?? new NodePs();
	// The container's hosting platform supplies this secret, never a person's shell.
	const secret = await new Credentials([new Environment({ ps })]).require(
		"SPLATES_RUNNER_SECRET",
	);
	const server = new RunnerServer(ps, {
		secret,
		port: opts.port,
		home: `${splatesHome(ps)}/runner`,
	});
	const signals = new Disposer();
	try {
		await new Promise<void>((resolve) => {
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
