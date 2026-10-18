import { CoordinatorBox } from "../coordinator";
import { RUNNING } from "../server/shared";
import { PULUMI_PASSPHRASE, pulumiPaths } from "../workers";
import { WORKERS_AREA } from "./area-workers";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";

export const COORDINATOR_AREA: SetupArea = coordinatorArea();

function coordinatorArea(): SetupArea {
	const workerStep = (id: string): SetupStep => {
		const step = WORKERS_AREA.steps.find((each) => each.id === id);
		if (step === undefined) {
			throw new Error(`no setup step ${id} in the Workers area`);
		}
		return step;
	};

	const boxStep: SetupStep = {
		id: "coordinator-box",
		title: "Make the coordinator's box",
		why: "An always-on box keeps the page, the queue and merging up while this machine sleeps. It is a CPX21 in Hetzner's Ashburn, Virginia, with Hetzner's daily backups, reached by SSH alone; it serves nothing until the coordinator moves onto it.",
		user: "Next makes it in your Hetzner account, through the token and Pulumi state the Workers area readied: about $38 a month, its backups 20% more.",
		agent:
			"Press Next on the page, or run `splates coordinator up`, which makes the box and prints its address and how to SSH in; run again, it changes only what is not so already.",
		optional: true,
		after: [workerStep("pulumi-state"), workerStep("hetzner-token")],
		doing: "Making the coordinator's box, a few minutes…",
		check: async (machine) => {
			if (!(await pulumiReady(machine))) {
				return false;
			}
			return (await box(machine).status()) !== null;
		},
		submit: async (machine) => {
			await box(machine).up();
		},
	};

	return {
		id: "coordinator",
		title: "Cloud coordinator",
		steps: [boxStep],
	};
}

/** Whether Pulumi is installed and has its passphrase, short of which no box was made. */
async function pulumiReady({
	fs,
	home,
	device,
}: SetupMachine): Promise<boolean> {
	return (
		(await fs.exists(pulumiPaths(home).bin)) &&
		(await device.get(PULUMI_PASSPHRASE)) !== undefined
	);
}

function box(machine: SetupMachine): CoordinatorBox {
	return new CoordinatorBox({
		version: RUNNING,
		ps: machine.ps,
		fs: machine.fs,
		home: machine.home,
		store: machine.device,
	});
}
