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
import { REMOTE_ACCESS_AREA } from "./area-remote";
import {
	CLOUD_TOKEN_MISSING,
	cloudChoiceStep,
	cloudOf,
	cloudTokenAccepted,
	cloudTokenFields,
	requireCloudToken,
} from "./cloud";
import { coordinatorMoved } from "./coordinator-move";
import { setupProjectAt } from "./project";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";

/** What the keys step hands its page: each deploy key GitHub does not let push yet. */
export interface CoordinatorKeys extends Record<string, unknown> {
	keys: DeployKey[];
}

/** What the Cloud server area runs on beyond the machine. */
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
	const tunnelStep = REMOTE_ACCESS_AREA.steps.find(
		(step) => step.id === "tunnel",
	) as SetupStep;
	// The last dry run each splates home ran here: the dry run brings the
	// box's splates up and pushes to GitHub, too slow for each read of setup.
	const dryRuns = new Map<string, Moved>();

	const choiceStep = cloudChoiceStep("coordinator-cloud");

	const boxStep: SetupStep = {
		id: "coordinator-box",
		title: "Make the server's box",
		why: "An always-on box keeps the page, the queue and merging up while this machine sleeps. It is a small machine in your account with the cloud provider you chose, reached by SSH alone; it serves nothing until the server is deployed to it.",
		user: "Paste your cloud provider's API token, or leave the one saved, and Next makes the box in that account.",
		agent:
			"Without the cred the step names, request it with `splates creds request <cred> --device` and `splates creds wait <cred>`, never in chat. Then press Next on the page, or run `splates server deploy --dry-run`, which makes the box, then stops once it is ready or says what the deploy still needs; `splates server status` prints its address.",
		optional: true,
		after: [choiceStep],
		// The page asks for the token here, so this journey never sends the user to another for it.
		fields: cloudTokenFields,
		detail: async (machine) => {
			const cloud = await cloudOf(machine);
			return `In ${cloud.name}, it is ${cloud.defaults.box.about}.`;
		},
		doing: "Making the coordinator's box, a few minutes…",
		notDone: CLOUD_TOKEN_MISSING,
		check: async (machine) => {
			if (await coordinatorMoved(machine)) {
				return true;
			}
			// Without a token the cloud takes there is no box to ask it about.
			if (!(await cloudTokenAccepted(machine))) {
				return false;
			}
			return (await (await box(machine)).status()) !== null;
		},
		submit: async (machine) => {
			await requireCloudToken(machine);
			await (await box(machine)).up();
		},
	};

	const remotesStep: SetupStep = {
		id: "coordinator-remotes",
		title: "Name each project's remote",
		why: "The box keeps a clone of each project, and this Mac checks tasks out from it as a worker, both through the remote each project's `splates.config.ts` names, reached over SSH so the box's deploy key can push.",
		user: 'Add `remote: "origin"` to each project\'s `splates.config.ts`, with an SSH origin such as `git@github.com:<owner>/<repo>.git`, then press Next.',
		agent:
			'For each project the step\'s detail lists, have a task in that project add `remote: "origin"` to its `splates.config.ts` and land it, and make its origin an SSH URL (`git remote set-url origin git@github.com:<owner>/<repo>.git`) if it is not. `splates server deploy --dry-run` lists what is still missing.',
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
		why: "The box gives each project a deploy key of its own, which merges push trunk with once the server runs there. GitHub lets a key push only once it is added to its repository with write access.",
		user: "Press Next to ready each project's clone on the box. Add each key it shows to its repository with **Allow write access** ticked, then press Next again.",
		agent:
			"Run `splates server deploy --dry-run`, which brings the box's splates to this release, gives each project a clone there and a deploy key, and exits `blocked` printing each key that cannot push yet with where to add it. Show the user each key and link, to add with **Allow write access** ticked, and run it again until it says the box is ready.",
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
		title: "Deploy the server to its box",
		why: "The deploy asks every agent here to checkpoint and stops this machine's `splates server`, carries its records and creds to the box, and starts the server there for good on your tunnel's host. This Mac then carries on as the box's worker, each task in its worktree here, and its own records go aside, kept.",
		user: "Press Next to deploy. This page goes away while the deploy runs, a few minutes, and comes back served from the box.",
		agent:
			"Ask the user first: the deploy stops their `splates server` and every agent in it. Then run `splates server deploy` from a terminal on this Mac, not under `splates server`, which it stops. It prints the box's URL, where the page now is, and the LaunchAgent that keeps this Mac its worker. On a failure it says what to fix and that nothing here changed: start `splates server` again and deploy once it is fixed.",
		optional: true,
		after: [keysStep],
		check: coordinatorMoved,
		notDone:
			"The server is not deployed yet: press Next to deploy it, or run `splates server deploy`.",
	};

	return {
		id: "coordinator",
		title: "Cloud server",
		steps: [choiceStep, boxStep, remotesStep, keysStep, moveStep],
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

async function box(machine: SetupMachine): Promise<CoordinatorBox> {
	return new CoordinatorBox({
		version: RUNNING,
		cloud: await cloudOf(machine),
		ps: machine.ps,
		fs: machine.fs,
		home: machine.home,
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
