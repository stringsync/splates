import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { z } from "zod";
import { fail } from "../exit";
import { splatesHome } from "../models";
import { relayOf } from "../records";
import { DEFAULT_PORT } from "../server/shared";
import { table } from "../table";
import { LOCAL_WORKER } from "../workers";

const Listed = z.object({
	base: z.string().nullable(),
	ports: z.array(
		z.object({
			task: z.string(),
			port: z.number(),
			worker: z.string(),
			local: z.string(),
			onWorker: z.string(),
			remote: z.string().nullable(),
		}),
	),
});

/** What `splates ports` is run with. */
export interface PortsOptions {
	/** Only this task's; empty for every task's. */
	task: string;
	/**
	 * The `splates server` to ask; empty for the one this agent runs under,
	 * else the coordinator this machine's worker daemon relays to, else this
	 * machine's.
	 */
	dev: string;
	json: boolean;
	log: Logger;
	fs: Fs;
	ps: Ps;
	send?: typeof fetch;
}

/**
 * `splates ports`: asks the running `splates server` which ports tasks serve, each
 * with its link through the saved ports host and its link on this machine,
 * so an agent can hand the user both. On a worker whose coordinator runs
 * elsewhere, only that worker's own ports open on this machine.
 */
export async function portsLs(opts: PortsOptions): Promise<void> {
	const { log, fs, ps, send = fetch } = opts;
	const relay = await relayOf(
		{ fs, env: (name) => ps.env(name) },
		splatesHome(ps),
	);
	const url = opts.dev || relay?.url || `http://localhost:${DEFAULT_PORT}`;
	const here = relay?.worker ?? null;
	let response: Response;
	try {
		// The server refuses a request from any other origin than its own.
		response = await send(new URL("/api/ports", url), {
			headers: { origin: new URL(url).origin },
		});
	} catch (error) {
		fail(
			"not_found",
			`splates server at ${url} could not be reached: ${error instanceof Error ? error.message : String(error)}; give its URL with --dev`,
		);
	}
	if (!response.ok) {
		fail(
			"not_found",
			`splates server at ${url} did not list the task ports: ${response.status} ${await response.text()}`,
		);
	}
	const listed = Listed.parse(await response.json());
	const ports = listed.ports
		.filter((each) => opts.task === "" || each.task === opts.task)
		.map(({ task, port, worker, local, onWorker, remote }) => ({
			task,
			port,
			worker,
			remote,
			local: localHere(here, { worker, local, onWorker }),
		}));
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
				each.local ?? `- (on ${each.worker})`,
			]),
		),
	];
	if (listed.base === null) {
		lines.push(
			"no ports host saved, so these open on this machine alone: `splates server --ports-host <base>` serves them at https://<task>-<port>.<base>",
		);
	}
	log.info(lines.join("\n"));
}

/**
 * A port's link on the machine `splates ports` runs on, `here` the worker it
 * is, null for none: the coordinator's forward on the coordinator's machine,
 * which runs the local worker; on any other worker, the port itself when the
 * worker serves it, and null when another does, which opens only remotely.
 */
function localHere(
	here: string | null,
	link: { worker: string; local: string; onWorker: string },
): string | null {
	if (here === null || here === LOCAL_WORKER) {
		return link.local;
	}
	return link.worker === here ? link.onWorker : null;
}
