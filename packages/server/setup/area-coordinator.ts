import { MemoryLogger } from "webappwiz/log";
import { FileLock } from "webappwiz/system";
import {
	CoordinatorBox,
	type CoordinatorMove,
	type DeployKey,
	type Moved,
	machineMove,
	remoteProblem,
} from "../coordinator";
import { SYSTEM_STORES } from "../creds";
import { Projects } from "../projects";
import { DEFAULT_PORT, RUNNING } from "../server/shared";
import { PULUMI_PASSPHRASE, pulumiPaths } from "../workers";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { WORKERS_AREA } from "./area-workers";
import { coordinatorMoved } from "./coordinator-move";
import { setupProjectAt } from "./project";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";

/** What the keys step hands its page: each deploy key GitHub does not let push yet. */
export interface CoordinatorKeys extends Record<string, unknown> {
	keys: DeployKey[];
}

/** What the Cloud coordinator area runs on beyond the machine. */
export interface CoordinatorAreaDeps {
	/** The move of this machine's coordinator onto its box, which the keys step runs dry. */
	move(machine: SetupMachine): Pick<CoordinatorMove, "run">;
	/** Each project this machine's coordinator keeps, with its central remote. */
	projects(machine: SetupMachine): Promise<MovingProject[]>;
}

/** A project as the move checks its remote. */
export type MovingProject = Parameters<typeof remoteProblem>[0];

export const COORDINATOR_AREA: SetupArea = coordinatorArea();

/**
 * Making the coordinator's box, then moving the coordinator onto it: each
 * project's remote, the box's deploy keys, and the move itself. Once moved,
 * every step reads done on either side, the box and this Mac alike.
 */
export function coordinatorArea(
	deps: CoordinatorAreaDeps = { move: defaultMove, projects: machineProjects },
): SetupArea {
	const workerStep = (id: string): SetupStep => {
		const step = WORKERS_AREA.steps.find((each) => each.id === id);
		if (step === undefined) {
			throw new Error(`no setup step ${id} in the Workers area`);
		}
		return step;
	};
	const tunnelStep = REMOTE_ACCESS_AREA.steps.find(
		(step) => step.id === "tunnel",
	) as SetupStep;
	// The last dry run each splates home ran here: the dry run brings the
	// box's splates up and pushes to GitHub, too slow for each read of setup.
	const dryRuns = new Map<string, Moved>();

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
			if (await coordinatorMoved(machine)) {
				return true;
			}
			if (!(await pulumiReady(machine))) {
				return false;
			}
			return (await box(machine).status()) !== null;
		},
		submit: async (machine) => {
			await box(machine).up();
		},
	};

	const remotesStep: SetupStep = {
		id: "coordinator-remotes",
		title: "Name each project's remote",
		why: "The box keeps a clone of each project, and this Mac checks tasks out from it as a worker, both through the remote each project's `splates.config.ts` names, reached over SSH so the box's deploy key can push.",
		user: 'Add `remote: "origin"` to each project\'s `splates.config.ts`, with an SSH origin such as `git@github.com:<owner>/<repo>.git`, then press Next.',
		agent:
			'For each project the step\'s detail lists, have a task in that project add `remote: "origin"` to its `splates.config.ts` and land it, and make its origin an SSH URL (`git remote set-url origin git@github.com:<owner>/<repo>.git`) if it is not. `splates coordinator move --dry-run` lists what is still missing.',
		optional: true,
		after: [],
		check: async (machine) =>
			(await coordinatorMoved(machine)) ||
			(await remoteProblems(deps, machine)).length === 0,
		detail: async (machine) => {
			if (await coordinatorMoved(machine)) {
				return null;
			}
			const problems = await remoteProblems(deps, machine);
			return problems.length === 0 ? null : `Still: ${problems.join("; ")}.`;
		},
		notDone:
			"Not every project names an SSH remote yet: the step lists what is missing.",
	};

	const keysStep: SetupStep = {
		id: "coordinator-keys",
		title: "Let the box push each project",
		why: "The box gives each project a deploy key of its own, which merges push trunk with once the coordinator runs there. GitHub lets a key push only once it is added to its repository with write access.",
		user: "Press Next to ready each project's clone on the box. Add each key it shows to its repository with **Allow write access** ticked, then press Next again.",
		agent:
			"Run `splates coordinator move --dry-run`, which brings the box's splates to this release, gives each project a clone there and a deploy key, and exits `blocked` printing each key that cannot push yet with where to add it. Show the user each key and link, to add with **Allow write access** ticked, and run it again until it says the box is ready.",
		optional: true,
		after: [boxStep, remotesStep, tunnelStep],
		doing: "Readying each project's clone on the box, a minute or two…",
		check: async (machine) =>
			(await coordinatorMoved(machine)) ||
			dryRuns.get(machine.home)?.status === "ready",
		data: async (machine): Promise<CoordinatorKeys | null> => {
			const last = dryRuns.get(machine.home);
			return last?.status === "keys" ? { keys: last.keys } : null;
		},
		submit: async (machine) => {
			dryRuns.set(machine.home, await deps.move(machine).run({ dryRun: true }));
		},
		notDone:
			"GitHub does not let each deploy key push yet: add each one below with Allow write access ticked, then press Next.",
	};

	const moveStep: SetupStep = {
		id: "coordinator-move",
		title: "Move the coordinator onto its box",
		why: "The move asks every agent here to checkpoint and stops this machine's `splates server`, carries its records and creds to the box, and starts the server there for good on your tunnel's host. This Mac then carries on as the box's worker, each task in its worktree here, and its own records go aside, kept.",
		user: "Press Next to move. This page goes away while the move runs, a few minutes, and comes back served from the box.",
		agent:
			"Ask the user first: the move stops their `splates server` and every agent in it. Then run `splates coordinator move` from a terminal on this Mac, not under `splates server`, which it stops. It prints the box's URL, where the page now is, and the LaunchAgent that keeps this Mac its worker. On a failure it says what to fix and that nothing here changed: start `splates server` again and move once it is fixed.",
		optional: true,
		after: [keysStep],
		check: coordinatorMoved,
		notDone:
			"The coordinator has not moved yet: press Next to move it, or run `splates coordinator move`.",
	};

	return {
		id: "coordinator",
		title: "Cloud coordinator",
		steps: [boxStep, remotesStep, keysStep, moveStep],
	};
}

/** What keeps each project on this machine from moving: its remote, as the move checks it. */
async function remoteProblems(
	deps: CoordinatorAreaDeps,
	machine: SetupMachine,
): Promise<string[]> {
	const projects = await deps.projects(machine);
	if (projects.length === 0) {
		return ["no project here to move: `splates projects` lists none"];
	}
	return projects.flatMap((project) => remoteProblem(project) ?? []);
}

/** Each project registered on this machine and not gone, read afresh. */
async function machineProjects(
	machine: SetupMachine,
): Promise<MovingProject[]> {
	const { fs, ps, home } = machine;
	if (ps === undefined) {
		throw new Error("setup cannot read the projects here");
	}
	const projects = await new Projects(`${home}/projects.json`, {
		fs,
		lock: new FileLock(`${home}/projects.lock`, {
			fs,
			ps,
			log: new MemoryLogger(),
		}),
	}).list();
	const moving: MovingProject[] = [];
	for (const { slug, root, gone } of projects) {
		if (gone) {
			continue;
		}
		const project = setupProjectAt(root, { fs, ps });
		const { remote } = await project.config();
		moving.push({
			slug,
			root,
			remote,
			url: remote === null ? null : await project.remoteUrl(remote),
		});
	}
	return moving;
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

/** The machine's own move, through its system stores but for the device's this setup reads. */
function defaultMove(machine: SetupMachine): Pick<CoordinatorMove, "run"> {
	if (machine.ps === undefined) {
		throw new Error("setup cannot reach the box from here");
	}
	return machineMove({
		ps: machine.ps,
		fs: machine.fs,
		log: new MemoryLogger(),
		version: RUNNING,
		// A dry run stops no server.
		dev: `http://localhost:${DEFAULT_PORT}`,
		stores: { ...SYSTEM_STORES, device: machine.device },
		...(machine.fetch === undefined ? {} : { fetch: machine.fetch }),
	});
}
