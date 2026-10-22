import { MemoryLogger } from "webappwiz/log";
import { z } from "zod";
import { FsStorage } from "../storage";
import {
	API_TOKEN,
	CloudflareApi,
	CloudflareError,
	CloudflareTunnels,
	SavedTunnel,
} from "../tunnel";
import { LOCAL_WORKER } from "../workers";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import type { SetupArea, SetupMachine, SetupStep, SetupWorker } from "./setup";

/**
 * This Mac's worker, which runs every agent, and the Access service tokens
 * made workers join with.
 */
export const WORKERS_AREA: SetupArea = workersArea();

function workersArea(): SetupArea {
	const tunnelStep = REMOTE_ACCESS_AREA.steps.find(
		(step) => step.id === "tunnel",
	) as SetupStep;

	const localStep: SetupStep = {
		id: "local-worker",
		title: "Make this Mac a worker",
		why: "Agents run on this Mac's own worker, the agents other agents start up to its slots at a time.",
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
		undo: {
			removes: async () => [
				`This Mac's worker, \`${LOCAL_WORKER}\`, its agents running to their end first`,
			],
			refused: noRemoving,
			run: (machine) => removeWorkers(machine, (each) => each.kind === "local"),
		},
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
			const saved = await SavedTunnel.in(
				new FsStorage(`${home}`, fs),
				device,
			).read();
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
		undo: {
			removes: async () => [],
			leaves: async () => [
				"The API token's **Access: Service Tokens · Edit** permission: take it off at [Cloudflare's API tokens](https://dash.cloudflare.com/profile/api-tokens) if nothing else needs it.",
			],
			run: async () => {},
		},
	};

	return {
		id: "workers",
		title: "Workers",
		steps: [localStep, permissionStep],
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

function _requireProject({ project }: SetupMachine) {
	if (project === undefined) {
		throw new Error(
			"No project to check: open Setup from a project, or run `splates setup` in its repository.",
		);
	}
	return project;
}

/** Why a worker cannot be removed from here: no `splates server` to remove it; null when one can. */
async function noRemoving(machine: SetupMachine): Promise<string | null> {
	return machine.removeWorker === undefined
		? "No `splates server` to remove workers from: start one, or give --dev."
		: null;
}

/** Removes each worker the pool lists that `which` picks, passing over one being removed already. */
async function removeWorkers(
	machine: SetupMachine,
	which: (worker: SetupWorker) => boolean,
): Promise<void> {
	if (machine.removeWorker === undefined) {
		throw new Error("no `splates server` to remove workers from");
	}
	for (const worker of await pool(machine)) {
		if (which(worker) && !worker.removing) {
			await machine.removeWorker(worker.id);
		}
	}
}
