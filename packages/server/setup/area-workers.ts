import { LOCAL_WORKER } from "../workers";
import type { SetupArea, SetupMachine, SetupStep, SetupWorker } from "./setup";

/**
 * This machine's worker, which runs every agent.
 */
export const WORKERS_AREA: SetupArea = workersArea();

function workersArea(): SetupArea {
	const localStep: SetupStep = {
		id: "local-worker",
		title: "Make this Mac a worker",
		why: "Agents run on this Mac's own worker, as many at once as are started.",
		user: "Press Next: this Mac takes agents unless its worker was removed.",
		agent:
			"Run `splates worker drain local --undo`, which turns this Mac's own worker back on if it was removed. Check `splates worker list`.",
		optional: true,
		after: [],
		check: async (machine) => {
			const local = (await pool(machine)).find(
				(worker) => worker.kind === "local",
			);
			return local !== undefined && !local.draining && !local.removing;
		},
		notDone:
			"This Mac is not taking agents yet: run `splates worker drain local --undo`, then press Next.",
		undo: {
			removes: async () => [
				`This Mac's worker, \`${LOCAL_WORKER}\`, its agents running to their end first`,
			],
			refused: noRemoving,
			run: (machine) => removeWorkers(machine, (each) => each.kind === "local"),
		},
	};

	return {
		id: "workers",
		title: "Workers",
		steps: [localStep],
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
