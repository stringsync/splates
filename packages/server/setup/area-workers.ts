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
import { WORKER_KEY_STEPS } from "./area-worker-keys";
import type { SetupArea, SetupMachine, SetupStep, SetupWorker } from "./setup";

/**
 * Running agents on this Mac and on other machines: the pool `splates server`
 * places them on.
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

/** Whether `worker` runs in WSL2, as a Windows machine's does. */
function wsl(worker: SetupWorker): boolean {
	return worker.host === "wsl2";
}
