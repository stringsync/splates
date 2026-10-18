import { MemoryLogger } from "webappwiz/log";
import { z } from "zod";
import {
	API_TOKEN,
	CloudflareApi,
	CloudflareError,
	CloudflareTunnels,
	SavedTunnel,
} from "../tunnel";
import {
	DEFAULT_WORKER_LIMITS,
	dollars,
	WORKER_LIMITS,
	type WorkerLimit,
} from "../workers";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { WORKER_KEY_STEPS } from "./area-worker-keys";
import type {
	SetupArea,
	SetupMachine,
	SetupStep,
	SetupWorkerBudget,
	StepField,
} from "./setup";

/** What each limit is asked as, in the order the budget lists them. */
const LIMIT_FIELDS: readonly StepField[] = [
	field("hour", "Most made workers running at once may cost, dollars an hour"),
	field("day", "Most made workers may cost in a day, dollars"),
	field("month", "Most made workers may cost in a month, dollars"),
];

function field(limit: WorkerLimit, label: string): StepField {
	return {
		kind: "text",
		name: limit,
		label,
		placeholder: String(DEFAULT_WORKER_LIMITS[limit]),
		optional: true,
	};
}

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

	const budgetStep: SetupStep = {
		id: "worker-budget",
		title: "Choose what made workers may cost",
		why: "`workerProvider` makes workers when work waits and bills your cloud account for them, so splates holds them to a rate cap an hour and to limits on a day and a month. The defaults already hold; this is your chance to see and change them.",
		user: "Set the most made workers may cost, in dollars, or leave a field empty to keep what it shows, then press Next.",
		agent: `Show the user the three limits with \`splates budget show\` and the type's price from the step's detail, and ask what each should be. Run \`splates budget set <hour|day|month> <dollars>\` for each, or \`splates budget set <limit> default\` to keep the default (${WORKER_LIMITS.map((limit) => `${limit} ${dollars(DEFAULT_WORKER_LIMITS[limit])}`).join(", ")}). Any set counts as the user having seen the budget.`,
		optional: true,
		after: [],
		shown: async (machine) =>
			((await machine.project?.config())?.workerProvider ?? null) !== null,
		detail: async (machine) => {
			const provider = (await machine.project?.config())?.workerProvider;
			const types = (await provider?.types()) ?? [];
			const cheapest = types.toSorted(
				(cheap, dear) => cheap.dollarsPerHour - dear.dollarsPerHour,
			)[0];
			return cheapest === undefined
				? null
				: `The cheapest worker is \`${cheapest.name}\`: ${cheapest.platform}, ${cheapest.slots} ${cheapest.slots === 1 ? "slot" : "slots"}, ${dollars(cheapest.dollarsPerHour)} an hour at list price.`;
		},
		fields: LIMIT_FIELDS,
		submit: async (machine, answers) => {
			const budget = budgetOf(machine);
			const chosen = new Map<WorkerLimit, number>();
			for (const field of LIMIT_FIELDS) {
				const text = String(answers[field.name] ?? "")
					.trim()
					.replace(/^\$/, "");
				if (text === "") {
					continue;
				}
				const value = Number(text);
				if (!(Number.isFinite(value) && value >= 0)) {
					throw new Error(
						`"${field.label}" should be dollars, like 5 or 0.25.`,
					);
				}
				chosen.set(field.name as WorkerLimit, value);
			}
			const { standing } = await budget.report();
			for (const each of standing) {
				// Left empty, a limit keeps what it was, which still counts as chosen.
				await budget.set(
					each.limit,
					chosen.get(each.limit) ??
						(each.set ? each.dollars - each.raised : null),
				);
			}
		},
		check: async (machine) => (await budgetOf(machine).report()).reviewed,
		notDone:
			"The worker budget has not been looked at: choose its limits, then press Next.",
	};

	return {
		id: "workers",
		title: "Workers",
		steps: [
			localStep,
			permissionStep,
			remoteStep,
			...WORKER_KEY_STEPS,
			budgetStep,
		],
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

/** The server's worker budget, or a throw saying there is none to ask. */
function budgetOf(machine: SetupMachine): SetupWorkerBudget {
	if (machine.workerBudget === undefined) {
		throw new Error(
			"no `splates server` to ask about its worker budget: start one, or give --dev",
		);
	}
	return machine.workerBudget;
}
