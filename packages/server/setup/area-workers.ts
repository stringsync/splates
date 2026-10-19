import { MemoryLogger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { z } from "zod";
import type { CloudProvider } from "../cloud";
import { RUNNING } from "../server/shared";
import { type Document, FsStorage } from "../storage";
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
	forgetSnapshot,
	type KeptSnapshots,
	keptSnapshot,
	LOCAL_WORKER,
	Snapshots,
	WORKER_LIMITS,
	type WorkerLimit,
} from "../workers";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { WORKER_KEY_STEPS } from "./area-worker-keys";
import {
	CLOUD_TOKEN_MISSING,
	CLOUD_USES,
	cloudChoiceStep,
	cloudOf,
	cloudTokenAccepted,
	cloudTokenFields,
	requireCloudToken,
} from "./cloud";
import type { StepField } from "./fields";
import type {
	SetupArea,
	SetupMachine,
	SetupStep,
	SetupWorker,
	SetupWorkerBudget,
} from "./setup";

/** What each limit is asked as, in the order the budget lists them. */
const LIMIT_FIELDS: readonly StepField[] = [
	field("hour", "Most made workers running at once may cost, dollars an hour"),
	field("day", "Most made workers may cost in a day, dollars"),
	field("month", "Most made workers may cost in a month, dollars"),
];

/**
 * Running agents on this Mac, on other machines, and on machines splates
 * makes in your own cloud account: the pool `splates server` places them on.
 */
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
		undo: {
			removes: async (machine) =>
				// Those in WSL2 the Windows step lists.
				(await pool(machine))
					.filter((worker) => worker.kind === "registered" && !wsl(worker))
					.map(
						(worker) =>
							`The worker \`${worker.id}\`, its key revoked, its agents running to their end first`,
					),
			leaves: async () => [
				"splates on each other machine: stop `splates worker run` there (Ctrl-C, or the service it runs under), then `bun remove -g @stringsync/splates` if you like; its key no longer works.",
			],
			refused: noRemoving,
			run: (machine) =>
				removeWorkers(machine, (each) => each.kind === "registered"),
		},
	};

	const windowsStep: SetupStep = {
		id: "windows-worker",
		title: "Add a Windows machine as a worker",
		why: "A Windows PC runs the Linux worker unchanged in WSL2, in a distro of its own, started at each boot whether or not anyone is signed in. It costs nothing an hour, and is held awake only while it runs an agent.",
		user: "On the Windows machine, open PowerShell as an administrator and run the Windows join command within 15 minutes of making it. If it says to restart Windows, restart, make a new token, and run it again. Then press Next.",
		agent:
			"Run `splates worker add` and give the user the Windows command it prints, with this server's URL in place of `<this server's URL>`, to run in PowerShell as an administrator on the Windows machine; the Workers page shows it too. It runs `windows/install-worker.ps1` of this release: turns WSL on (the first time, it asks for a restart and a new token), gives WSL2 all but 6 GB of memory in `.wslconfig`, makes the WSL2 distro `splates`, installs this release there, joins with the key kept in `~/.splates/worker.env` in the distro, and registers the scheduled task `splates worker`, which runs the worker at boot. Check `splates worker list` shows it as `linux (wsl2)`.",
		optional: true,
		after: [],
		check: async (machine) =>
			(await pool(machine)).some(
				(worker) => worker.kind === "registered" && wsl(worker),
			),
		notDone:
			"No Windows machine has joined yet: run the Windows join command on it in PowerShell as an administrator, then press Next.",
		undo: {
			removes: async (machine) =>
				(await pool(machine))
					.filter((worker) => worker.kind === "registered" && wsl(worker))
					.map(
						(worker) =>
							`The Windows worker \`${worker.id}\`, its key revoked, its agents running to their end first`,
					),
			leaves: async () => [
				"On the Windows machine, in PowerShell as an administrator: the scheduled task that starts the worker at boot, `Unregister-ScheduledTask -TaskName 'splates worker'`, and its WSL2 distro, `wsl --unregister splates`, which deletes everything in it. `.wslconfig` keeps the memory it gave WSL2.",
			],
			refused: noRemoving,
			run: (machine) =>
				removeWorkers(
					machine,
					(each) => each.kind === "registered" && wsl(each),
				),
		},
	};

	const wakeStep: SetupStep = {
		id: "wake-on-lan",
		title: "Let a Windows worker sleep, and wake it over the network",
		why: "A Windows worker lets the PC sleep when it runs nothing, and splates wakes it with a Wake-on-LAN packet when agents queue, before it makes a worker in the cloud. A PC that does not wake within two minutes never holds the queue up: splates makes one instead. The packet comes from a worker awake on the same network, such as this Mac's.",
		user: "Turn Wake-on-LAN on in the PC's BIOS or UEFI (often under Power Management, as Wake on LAN or Power On by PCI-E), and in Windows: Device Manager → Network adapters → the wired adapter → Properties, on Power Management tick Allow this device to wake the computer and Only allow a magic packet, and on Advanced set Wake on Magic Packet to Enabled. Wi-Fi rarely wakes a PC: use a cable. Then put the PC to sleep, press Wake on its card on the Workers page, and press Next once it shows connected.",
		agent:
			"Walk the user through turning Wake-on-LAN on: in the BIOS or UEFI, and in Windows' Device Manager for the wired adapter (Power Management: Allow this device to wake the computer, Only allow a magic packet; Advanced: Wake on Magic Packet, Enabled). Fast Startup can keep some adapters from waking a PC shut down, though not one asleep. Check `splates worker list` shows the PC; once the user has put it to sleep and it shows `asleep`, run `splates worker wake <id>` and check it shows `connected` within two minutes. A worker awake on the PC's network, such as this Mac's own, sends the packet: when none is, the wake fails saying so.",
		optional: true,
		after: [windowsStep],
		check: async (machine) =>
			(await pool(machine)).some(
				(worker) => worker.host === "wsl2" && worker.wokenAt !== null,
			),
		notDone:
			"No Windows worker has been woken yet: put the PC to sleep, press Wake on its card on the Workers page, and press Next once it shows connected.",
		undo: {
			removes: async () => [],
			leaves: async () => [
				"Wake-on-LAN, on in the PC's BIOS or UEFI and its wired adapter's settings in Device Manager: harmless left on, or turn it off there.",
			],
			run: async () => {},
		},
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
		undo: {
			removes: async () => [
				`The limits chosen for made workers, back to their defaults (${WORKER_LIMITS.map((limit) => `${limit} ${dollars(DEFAULT_WORKER_LIMITS[limit])}`).join(", ")})`,
			],
			refused: async (machine) =>
				machine.workerBudget?.unreview === undefined
					? "No `splates server` to put the worker budget back: undo it from the Setup page it serves."
					: null,
			run: async (machine) => {
				await budgetOf(machine).unreview?.();
			},
		},
	};

	const choiceStep = cloudChoiceStep("cloud-choice");

	const tokenStep: SetupStep = {
		id: "cloud-token",
		title: "Paste your cloud provider's API token",
		why: "Cloud workers are machines in your own account with the cloud provider you chose, made only while agents wait for a slot.",
		user: "Make an API token in your cloud provider's account and paste it.",
		agent:
			"Request the cred the step names with `splates creds request <cred> --device`, with how to get it, and `splates creds wait <cred>`. Never ask for it in chat.",
		optional: true,
		after: [choiceStep],
		fields: cloudTokenFields,
		detail: async (machine) => workerPrices(await cloudOf(machine)),
		submit: requireCloudToken,
		check: cloudTokenAccepted,
		notDone: CLOUD_TOKEN_MISSING,
		undo: {
			removes: async () => [],
			leaves: async (machine) => [
				`The token itself in your ${(await cloudOf(machine)).name} account: revoke it in its console, once nothing else uses it.`,
			],
			run: async () => {},
		},
	};

	const providerStep: SetupStep = {
		id: "cloud-provider",
		title: "Turn cloud workers on",
		why: "A project makes cloud workers once its `splates.config.ts` names its `cloud`, up to `provisionedWorkers` at once (2 by default), and only for work its agents hand out.",
		user: "Add the `cloud` the step shows to this project's `splates.config.ts` and merge it, as a task, then restart `splates server` and press Next.",
		agent:
			"In a task of its own, add the `cloud` the step's detail shows, imported from `@stringsync/splates-server/cloud`, to `splates.config.ts` and merge it; then have the user restart `splates server`, and run `splates setup cloud-provider`.",
		detail: async (machine) =>
			`Add \`cloud: ${(await cloudOf(machine)).configSource}\`.`,
		notDone:
			"`splates.config.ts` names no `cloud` yet: add it, merge it, then press Next.",
		optional: true,
		after: [tokenStep],
		check: async (machine) =>
			(await requireProject(machine).config()).workerProvider !== null,
		undo: {
			removes: async () => [],
			leaves: async () => [
				"`cloud` in this project's `splates.config.ts`: take it out in a task and merge it, then restart `splates server`, or it makes cloud workers again once a token is pasted.",
			],
			run: async () => {},
		},
	};

	const snapshotStep: SetupStep = {
		id: "worker-snapshot",
		title: "Build the worker snapshot",
		why: "Workers boot from a snapshot with splates already installed, so one is ready to work within a minute. splates rebuilds it when it updates or after a week.",
		user: "Next builds it on a small machine in your cloud account, about ten minutes and a few cents, then keeps it for about $0.10 a month.",
		agent:
			"Press Next on the page, which builds it through the project's `workerProvider`; or leave it, since the first cloud worker builds it too. It makes and destroys a builder server: do not run it twice at once.",
		optional: true,
		after: [providerStep],
		// Its image is deleted with the token, in the cloud chosen.
		uses: CLOUD_USES,
		doing: "Building the worker snapshot, about ten minutes…",
		check: async ({ fs, home }) =>
			(await keptSnapshot("linux", { document: snapshotsOf(home, fs) })) !==
			null,
		submit: async (machine) => {
			const { workerProvider } = await requireProject(machine).config();
			if (workerProvider === null) {
				throw new Error("`splates.config.ts` names no `workerProvider` yet.");
			}
			const snapshots = await Snapshots.open(workerProvider, {
				version: RUNNING,
				document: snapshotsOf(machine.home, machine.fs),
			});
			await snapshots.current("linux");
		},
		undo: {
			removes: async (machine) => {
				const kept = await keptSnapshot("linux", {
					document: snapshotsOf(machine.home, machine.fs),
				});
				return kept === null
					? []
					: [
							`The worker snapshot \`${kept.id}\` in ${(await cloudOf(machine)).name}, of splates ${kept.version}`,
						];
			},
			run: async (machine) => {
				const opts = { document: snapshotsOf(machine.home, machine.fs) };
				const kept = await keptSnapshot("linux", opts);
				if (kept !== null) {
					await (await cloudOf(machine)).deleteSnapshot(kept.id);
				}
				await forgetSnapshot("linux", opts);
			},
		},
	};

	return {
		id: "workers",
		title: "Workers",
		steps: [
			localStep,
			permissionStep,
			remoteStep,
			windowsStep,
			wakeStep,
			...WORKER_KEY_STEPS,
			choiceStep,
			tokenStep,
			providerStep,
			budgetStep,
			snapshotStep,
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

/** Where `splates server` keeps the snapshot workers boot from, as `Snapshots` reads it. */
function snapshotsOf(home: string, fs: Fs): Document<KeptSnapshots> {
	return new FsStorage(home, fs).document<KeptSnapshots>("snapshots.json");
}

function requireProject({ project }: SetupMachine) {
	if (project === undefined) {
		throw new Error(
			"No project to check: open Setup from a project, or run `splates setup` in its repository.",
		);
	}
	return project;
}

function field(limit: WorkerLimit, label: string): StepField {
	return {
		kind: "text",
		name: limit,
		label,
		placeholder: String(DEFAULT_WORKER_LIMITS[limit]),
		optional: true,
	};
}

/** What `cloud`'s worker types cost, for the token step's detail. */
function workerPrices(cloud: CloudProvider): string {
	const types = cloud.defaults.workerTypes
		.map(
			(type) =>
				`a ${type.name} runs ${type.slots} agents for about ${dollars(type.dollarsPerHour)} an hour`,
		)
		.join(", ");
	const billing = cloud.defaults.workerTypes.some(
		(type) => type.billing === "hour",
	)
		? ", billed by the started hour"
		: ", billed for the time it runs";
	return `In ${cloud.name}, ${types}${billing}.`;
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

/** Whether `worker` runs in WSL2, as a Windows machine's does. */
function wsl(worker: SetupWorker): boolean {
	return worker.host === "wsl2";
}
