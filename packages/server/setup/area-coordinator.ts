import { MemoryLogger } from "webappwiz/log";
import {
	CoordinatorBox,
	type CoordinatorMove,
	coordinatorMoved,
	type Moved,
	machineMove,
	remoteProblem,
} from "../coordinator";
import { SYSTEM_STORES } from "../creds";
import { Projects } from "../projects";
import { DEFAULT_PORT, RUNNING } from "../server/shared";
import { FsStorage } from "../storage";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { awsAccessStep } from "./aws-access";
import { moveUnfinished } from "./coordinator-move";
import { setupProjectAt } from "./project";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";

/** What the creds step hands its page: each cred the box's Parameter Store still lacks. */
export interface CoordinatorNeeds extends Record<string, unknown> {
	needs: string[];
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

	const pulumiStep: SetupStep = {
		id: "coordinator-pulumi",
		title: "Install Pulumi and log in",
		why: "Pulumi makes and keeps the box as code in your account. It keeps the stack's state in Pulumi Cloud, whose ESC environments sign in to AWS with no long-lived key, or in an S3 bucket of your own.",
		user: "Install Pulumi (`brew install pulumi`), then `pulumi login` to Pulumi Cloud, or `pulumi login s3://<bucket>` for a backend of your own, and press Next.",
		agent:
			"Have the user install Pulumi and log in to Pulumi Cloud or an S3 backend of their own. The step is done when `pulumi whoami` answers.",
		optional: true,
		after: [],
		check: async (machine) =>
			(await coordinatorMoved(machine)) || (await pulumiAnswers(machine)),
		notDone:
			"Pulumi is not installed or logged in here: `pulumi login`, then press Next.",
		undo: {
			removes: async () => [],
			leaves: async () => [
				"Pulumi and its login: `pulumi logout` signs out, and nothing else here uses it.",
			],
			refused: movedRefusal,
			run: async () => {},
		},
	};

	const accessStep = awsAccessStep([pulumiStep]);

	const infraStep: SetupStep = {
		id: "coordinator-infra",
		title: "Write the infra project",
		why: "The box is a Pulumi project of your own that uses splates's components, so you can read, change and destroy exactly what it makes.",
		user: "Run `splates server infra init <dir>`, which writes the project, then press Next.",
		agent:
			"Run `splates server infra init <dir> --host <host> --email <email>` for the user, in a directory of their choice. It records the directory in splates's home.",
		optional: true,
		after: [],
		check: async (machine) => {
			if (await coordinatorMoved(machine)) {
				return true;
			}
			const infra = await box(machine).infra();
			return (
				infra !== null && (await machine.fs.exists(`${infra.dir}/Pulumi.yaml`))
			);
		},
		detail: async (machine) => {
			const infra = await box(machine).infra();
			return infra === null ? null : `The project is in ${infra.dir}.`;
		},
		notDone:
			"No infra project is written yet: run `splates server infra init <dir>`, then press Next.",
		undo: {
			removes: async () => [],
			leaves: async (machine) => {
				const infra = await box(machine).infra();
				return [
					`The project in ${infra?.dir ?? "its directory"}: delete it once \`pulumi destroy\` has unmade the stack.`,
				];
			},
			refused: movedRefusal,
			run: async () => {},
		},
	};

	const remotesStep: SetupStep = {
		id: "coordinator-remotes",
		title: "Give each project an SSH origin",
		why: "The box keeps a clone of each project, and this Mac checks tasks out from it as a worker, both through each project's `origin`, which an unset `remote` in its `splates.config.ts` means once the server moves, reached over SSH so the box's deploy key can push.",
		user: "Make each project's origin an SSH URL such as `git@github.com:<owner>/<repo>.git`, then press Next.",
		agent:
			"For each project the step's detail lists, make its origin an SSH URL (`git remote set-url origin git@github.com:<owner>/<repo>.git`) if it is not, and take any `remote: null` out of its `splates.config.ts` in a task of that project. `splates server deploy --dry-run` lists what is still missing.",
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
			"Not every project has an SSH origin yet: the step lists what is missing.",
		undo: {
			removes: async () => [],
			leaves: async () => ["Each project's SSH origin: harmless kept."],
			refused: movedRefusal,
			run: async () => {},
		},
	};

	const upStep: SetupStep = {
		id: "coordinator-up",
		title: "Bring the server's box up",
		why: "An always-on box keeps the page, the queue and merging up while this machine sleeps. It is a small EC2 instance in your AWS account that your Pulumi project makes, reached by SSH alone; it serves nothing until the server is deployed to it.",
		user: "Set the stack's config (`splates server infra init` prints what), run `pulumi up` in the project's directory, and press Next.",
		agent:
			"Have the user set the stack's config and secrets and run `pulumi up` in the infra project's directory. The step is done when `pulumi stack output --json` gives the instance id and tunnel host; `splates server status` prints the box's address.",
		optional: true,
		after: [accessStep, pulumiStep, infraStep],
		detail: async () =>
			"The Pulumi stack makes the instance, its role, snapshots and creds.",
		notDone:
			"The stack has made no box yet: `pulumi up` in the infra project's directory.",
		check: async (machine) => {
			if (await coordinatorMoved(machine)) {
				return true;
			}
			return (
				(await box(machine)
					.status()
					.catch(() => null)) !== null
			);
		},
		undo: {
			removes: async () => [],
			leaves: async (machine) => {
				const infra = await box(machine).infra();
				return [
					`The box and everything the stack made: \`pulumi destroy\`${infra === null ? "" : ` in ${infra.dir}`} unmakes them.`,
				];
			},
			refused: movedRefusal,
			run: async () => {},
		},
	};

	const credsStep: SetupStep = {
		id: "coordinator-creds",
		title: "Give the box its creds",
		why: "The box reads a deploy key per project, and its tunnel token, from its Parameter Store, where the Pulumi stack put them, and clones and pushes trunk with them once the server runs there.",
		user: "Press Next to ready each project's clone on the box. If it lists creds the box lacks, set each with `pulumi config set --secret`, run `pulumi up`, then press Next again.",
		agent:
			"Run `splates server deploy --dry-run`, which brings the box's splates to this release, and exits `blocked` naming each cred the box's Parameter Store lacks. Have the user fix the stack and `pulumi up`, and run it again until it says the box is ready.",
		optional: true,
		after: [upStep, remotesStep, tunnelStep],
		doing: "Readying each project's clone on the box, a minute or two…",
		detail: async (machine) => {
			const last = dryRuns.get(machine.home);
			return last?.status === "blocked"
				? last.needs
						.map((name) => `\`pulumi config set --secret ${name} <value>\``)
						.join("\n")
				: null;
		},
		check: async (machine) =>
			(await coordinatorMoved(machine)) ||
			dryRuns.get(machine.home)?.status === "ready",
		data: async (machine): Promise<CoordinatorNeeds | null> => {
			const last = dryRuns.get(machine.home);
			return last?.status === "blocked" ? { needs: last.needs } : null;
		},
		submit: async (machine) => {
			dryRuns.set(machine.home, await deps.move(machine).run({ dryRun: true }));
		},
		undo: {
			removes: async () => [],
			leaves: async () => [
				"The deploy keys and creds the Pulumi stack put in the box's Parameter Store.",
			],
			refused: movedRefusal,
			run: async (machine) => {
				dryRuns.delete(machine.home);
			},
		},
		notDone:
			"The box lacks creds in its Parameter Store: see the list below, fix the stack, `pulumi up`, then press Next.",
	};

	const moveStep: SetupStep = {
		id: "coordinator-move",
		title: "Deploy the server to its box",
		why: "The deploy asks every agent here to checkpoint and stops this machine's `splates server`, carries its records to the box (it reads its own creds), and starts the server there for good on your tunnel's host. This Mac then carries on as the box's worker, each task in its worktree here, and its own records go aside, kept.",
		user: "Press Next to deploy. This page goes away while the deploy runs, a few minutes, and comes back served from the box.",
		agent:
			"Ask the user first: the deploy stops their `splates server` and every agent in it. Then run `splates server deploy` from a terminal on this Mac, not under `splates server`, which it stops. It prints the box's URL, where the page now is, and the LaunchAgent that keeps this Mac its worker. On a failure it says what to fix and that nothing here changed: start `splates server` again and deploy once it is fixed.",
		optional: true,
		after: [credsStep],
		check: async (machine) =>
			(await coordinatorMoved(machine)) && !(await moveUnfinished(machine)),
		detail: async (machine) =>
			(await moveUnfinished(machine))
				? "The server runs on its box, but this Mac has not joined it as a worker yet: the deploy stopped on its way. Next, or `splates server deploy`, finishes it."
				: null,
		notDone:
			"The server is not deployed yet: press Next to deploy it, or run `splates server deploy`.",
		// Done only once moved, which refuses every undo.
		undo: {
			removes: async () => [],
			refused: movedRefusal,
			run: async () => {},
		},
	};

	return {
		id: "coordinator",
		title: "Cloud server",
		steps: [
			pulumiStep,
			accessStep,
			infraStep,
			remotesStep,
			upStep,
			credsStep,
			moveStep,
		],
	};
}

/** Why nothing of the Cloud server comes undone once the server has moved onto its box. */
async function movedRefusal(machine: SetupMachine): Promise<string | null> {
	return (await coordinatorMoved(machine))
		? "splates server runs on its box now, holding the only live records; move it back first (task #385)."
		: null;
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
	const projects = await Projects.in(
		FsStorage.ofMachine({ fs, ps, log: new MemoryLogger(), home }),
		fs,
	).list();
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

function box(machine: SetupMachine): CoordinatorBox {
	return new CoordinatorBox({
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

/** Whether Pulumi is installed and logged in here: `pulumi whoami` answers. */
async function pulumiAnswers(machine: SetupMachine): Promise<boolean> {
	if (machine.ps === undefined) {
		throw new Error("setup cannot run Pulumi here");
	}
	return machine.ps.spawnCapture(["pulumi", "whoami"]).then(
		({ exitCode }) => exitCode === 0,
		() => false,
	);
}
