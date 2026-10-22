import { MemoryLogger } from "webappwiz/log";
import { z } from "zod";
import { CloudWorkers } from "../cloud";
import { FsStorage } from "../storage";
import {
	API_TOKEN,
	CloudflareApi,
	CloudflareError,
	CloudflareTunnels,
	SavedTunnel,
} from "../tunnel";
import {
	DEFAULT_JOB_SIZE,
	LOCAL_WORKER,
	sizeLabel,
	type WorkerType,
} from "../workers";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import {
	CLOUD_USES,
	cloudOf,
	cloudTokenAccepted,
	cloudTokenFields,
	requireCloudToken,
} from "./cloud";
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

	const tokenStep: SetupStep = {
		id: "cloud-token",
		title: "Paste your cloud provider's API token",
		why: "Runners are machines in your own cloud account, made only while heavy jobs wait for one and deleted when they are done.",
		user: "Make an API token in your cloud provider's account and paste it.",
		agent:
			"Request the cred the step names with `splates creds request <cred> --device`, with how to get it, and `splates creds wait <cred>`. Never ask for it in chat.",
		optional: true,
		after: [],
		uses: CLOUD_USES,
		fields: async (machine) => cloudTokenFields(machine),
		detail: async (machine) => {
			const cloud = cloudOf(machine);
			const [type] = await runnerTypes(machine);
			return type?.cpus === undefined || type.memory === undefined
				? `A runner is the cheapest machine in ${cloud.name} that holds one of the project's heavy jobs, ${sizeLabel(DEFAULT_JOB_SIZE)} unless its \`splates.config.ts\` sets \`job\`.`
				: `A runner is a machine in ${cloud.name} of ${sizeLabel({ cpus: type.cpus, memory: type.memory }, type.dollarsPerHour)}, the cheapest that holds one of the project's heavy jobs, billed ${type.billing === "second" ? "for the time it runs" : "by the started hour"}.`;
		},
		submit: requireCloudToken,
		check: cloudTokenAccepted,
		notDone:
			"The cloud provider does not take the token kept: paste another, then press Next.",
		undo: {
			removes: async () => [],
			leaves: async () => [
				"The token itself in your cloud account: revoke it in its console, once nothing else uses it.",
			],
			run: async () => {},
		},
	};

	const providerStep: SetupStep = {
		id: "cloud-provider",
		title: "Turn cloud runners on",
		why: "A project makes runners once its `splates.config.ts` names its `cloud`.",
		user: "Add the `cloud` the step shows to this project's `splates.config.ts` and merge it, as a task, then restart `splates server` and press Next.",
		agent:
			"In a task of its own, add the `cloud` the step's detail shows, imported from `@stringsync/splates-server/cloud`, to `splates.config.ts` and merge it; then have the user restart `splates server`, and run `splates setup cloud-provider`.",
		detail: async (machine) =>
			`Add \`cloud: ${cloudOf(machine).configSource}\`.`,
		notDone:
			"`splates.config.ts` names no `cloud` yet: add it, merge it, then press Next.",
		optional: true,
		after: [tokenStep],
		check: async (machine) => {
			if (machine.project === undefined) {
				throw new Error(
					"No project to check: open Setup from a project, or run `splates setup` in its repository.",
				);
			}
			return (await machine.project.config()).workerProvider !== null;
		},
		undo: {
			removes: async () => [],
			leaves: async () => [
				"`cloud` in this project's `splates.config.ts`: take it out in a task and merge it, then restart `splates server`, or it makes runners again once a token is pasted.",
			],
			run: async () => {},
		},
	};

	return {
		id: "workers",
		title: "Workers",
		steps: [localStep, permissionStep, tokenStep, providerStep],
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

/**
 * The types runners would be made of, the cheapest first, sized for the
 * project's jobs once it names its cloud; none while the cloud does not
 * take the token kept, or cannot say.
 */
async function runnerTypes(machine: SetupMachine): Promise<WorkerType[]> {
	const cloud = cloudOf(machine);
	try {
		if (!(await cloud.accepted())) {
			return [];
		}
		const own = (await machine.project?.config())?.workerProvider;
		return await (own instanceof CloudWorkers
			? own
			: new CloudWorkers(cloud)
		).types();
	} catch {
		return [];
	}
}
