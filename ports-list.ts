import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { z } from "zod";
import { DEFAULT_PORT } from "./dev-ports";
import { fail } from "./exit";
import { table } from "./table";

const Listed = z.object({
	base: z.string().nullable(),
	ports: z.array(
		z.object({
			task: z.string(),
			port: z.number(),
			local: z.string(),
			remote: z.string().nullable(),
		}),
	),
});

/** What `arbor ports` is run with. */
export interface PortsOptions {
	/** Only this task's; empty for every task's. */
	task: string;
	/** The `arbor dev` to ask; empty for the one this agent runs under, or this machine's. */
	dev: string;
	json: boolean;
	log: Logger;
	ps: Ps;
	send?: typeof fetch;
}

/**
 * `arbor ports`: asks the running `arbor dev` which ports tasks serve, each
 * with its link through the saved ports host and its link on this machine,
 * so an agent can hand the user both.
 */
export async function portsLs(opts: PortsOptions): Promise<void> {
	const { log, ps, send = fetch } = opts;
	const url =
		opts.dev || ps.env("ARBOR_DEV") || `http://localhost:${DEFAULT_PORT}`;
	let response: Response;
	try {
		// The server refuses a request from any other origin than its own.
		response = await send(new URL("/api/ports", url), {
			headers: { origin: new URL(url).origin },
		});
	} catch (error) {
		fail(
			"not_found",
			`arbor dev at ${url} could not be reached: ${error instanceof Error ? error.message : String(error)}; give its URL with --dev`,
		);
	}
	if (!response.ok) {
		fail(
			"not_found",
			`arbor dev at ${url} did not list the task ports: ${response.status} ${await response.text()}`,
		);
	}
	const listed = Listed.parse(await response.json());
	const ports = listed.ports.filter(
		(each) => opts.task === "" || each.task === opts.task,
	);
	if (opts.json) {
		log.info(JSON.stringify({ base: listed.base, ports }, null, "\t"));
		return;
	}
	if (ports.length === 0) {
		log.info(
			opts.task === ""
				? "no task serves a port now"
				: `'${opts.task}' serves no port now: start its server from its worktree, then run this again`,
		);
		return;
	}
	const lines = [
		table(
			["task", "port", "remote", "local"],
			ports.map((each) => [
				each.task,
				String(each.port),
				each.remote ?? "-",
				each.local,
			]),
		),
	];
	if (listed.base === null) {
		lines.push(
			"no ports host saved, so these open on this machine alone: `arbor dev --ports-host <base>` serves them at https://<task>-<port>.<base>",
		);
	}
	log.info(lines.join("\n"));
}
