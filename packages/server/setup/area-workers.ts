import { MemoryLogger } from "webappwiz/log";
import { z } from "zod";
import {
	API_TOKEN,
	CloudflareApi,
	CloudflareError,
	CloudflareTunnels,
	SavedTunnel,
} from "../tunnel";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";

/** Running agents on this Mac and on other machines, the pool `splates server` places them on. */
export const WORKERS_AREA: SetupArea = workersArea();

function workersArea(): SetupArea {
	const tunnelStep = REMOTE_ACCESS_AREA.steps.find(
		(step) => step.id === "tunnel",
	) as SetupStep;

	const localStep: SetupStep = {
		id: "local-worker",
		title: "Make this Mac a worker",
		why: "Agents run on workers: this Mac, once it has slots, and any machine you register, up to each one's slots at a time.",
		user: "Pick how many agents this Mac runs at once.",
		agent:
			"Run `splates worker add --local <slots>` with the number the user picks, which makes this Mac's own worker run that many agents at once, turning it back on if it was removed. Check `splates worker list`.",
		optional: true,
		after: [],
		check: async (machine) => {
			const local = (await pool(machine)).find(
				(worker) => worker.kind === "local",
			);
			return local !== undefined && !local.draining && !local.removing;
		},
		notDone:
			"This Mac is not taking agents yet: run `splates worker add --local <slots>`, then press Next.",
	};

	const permissionStep: SetupStep = {
		id: "worker-access",
		title: "Let the API token mint worker service tokens",
		why: "A worker on another network joins through Cloudflare Access with a service token of its own, which `splates worker add` mints with your API token. A token made before workers needs a new one.",
		user: "Replace the Cloudflare API token with one that also holds **Account · Access: Service Tokens · Edit**, then press Next.",
		agent: `Run \`splates creds request ${API_TOKEN} --device --replace\`, with the permissions \`splates tunnel setup\` lists, and \`splates creds wait ${API_TOKEN}\`.`,
		optional: true,
		after: [tunnelStep],
		check: async (machine) => {
			const { fs, home, device } = machine;
			const saved = await new SavedTunnel(`${home}/tunnel.json`, {
				fs,
				store: device,
			}).read();
			const token = await device.get(API_TOKEN);
			if (saved === null || token === undefined) {
				return false;
			}
			const api = new CloudflareApi(token, { fetch: machine.fetch });
			const zone = await CloudflareTunnels.over(
				api,
				new MemoryLogger(),
			).findZone(saved.host);
			// Listing is the cheapest call the permission decides.
			return api
				.list(`/accounts/${zone.account.id}/access/service_tokens`, z.unknown())
				.then(
					() => true,
					(error: unknown) => {
						if (
							error instanceof CloudflareError &&
							(error.status === 401 || error.status === 403)
						) {
							return false;
						}
						throw error;
					},
				);
		},
		notDone:
			"The API token cannot manage Access service tokens: replace it with one that holds Account · Access: Service Tokens · Edit, then press Next.",
	};

	const remoteStep: SetupStep = {
		id: "remote-worker",
		title: "Register another machine as a worker",
		why: "A worker on another machine runs agents beside this Mac's, up to its slots, and dials back to `splates server`.",
		user: "Run the join command on the other machine within 15 minutes of making it, then press Next.",
		agent:
			"Run `splates worker add`, which prints a single-use join token good for 15 minutes, and have the user run `splates worker run --coordinator <url> --join <token>` on the other machine, which keeps its key in the system store (or `SPLATES_WORKER_KEY` on a machine with none). Through a tunnel the token also carries a Cloudflare Access service token, which the worker keeps as `SPLATES_WORKER_ACCESS_ID` and `SPLATES_WORKER_ACCESS_SECRET`. Check `splates worker list`.",
		optional: true,
		after: [],
		check: async (machine) =>
			(await pool(machine)).some((worker) => worker.kind === "registered"),
		notDone:
			"No other machine has joined yet: run `splates worker run --join <token>` on it, then press Next.",
	};

	return {
		id: "workers",
		title: "Workers",
		steps: [localStep, permissionStep, remoteStep],
	};
}

/** The workers `GET /api/workers` lists, read through the machine's server. */
async function pool(machine: SetupMachine) {
	if (machine.workers === undefined) {
		throw new Error(
			"no `splates server` to ask which workers it has: start one, or give --dev",
		);
	}
	return machine.workers();
}
