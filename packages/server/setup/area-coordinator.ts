import { Credentials } from "webappwiz/creds";
import { MemoryLogger } from "webappwiz/log";
import {
	type BoxCloud,
	CoordinatorBox,
	type CoordinatorMove,
	coordinatorMoved,
	type Moved,
	machineMove,
	remoteProblem,
	writeInfraConfig,
} from "../coordinator";
import { SYSTEM_STORES } from "../creds";
import { infraConfigure } from "../infra/configure";
import { Projects } from "../projects";
import { DEFAULT_PORT, RUNNING } from "../server/shared";
import { FsStorage } from "../storage";
import { SavedTunnel } from "../tunnel";
import { REMOTE_ACCESS_AREA } from "./area-remote";
import { awsAccessStep } from "./aws-access";
import { failedMove, moveUnfinished } from "./coordinator-move";
import { stackSecretsStep } from "./coordinator-secrets";
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
	/** The cloud the box is in, which destroying it lifts its protection through; AWS by default. */
	cloud?(machine: SetupMachine): BoxCloud;
}

/** A project as the move checks its remote. */
export type MovingProject = Parameters<typeof remoteProblem>[0];

/** What the box costs a month in dollars: the t3.medium, its disk and 7 daily snapshots. */
const BOX_MONTHLY_COST = 35;

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

	const box = (machine: SetupMachine): CoordinatorBox =>
		new CoordinatorBox({
			ps: machine.ps,
			fs: machine.fs,
			home: machine.home,
			...(deps.cloud === undefined ? {} : { cloud: deps.cloud(machine) }),
		});
	// What `pulumi preview` last said, per splates home, until `pulumi up` runs.
	const previews = new Map<string, string>();

	/** `pulumi up` in the infra project, under its ESC environment, then forgets the preview. */
	const pulumiUp = async (machine: SetupMachine): Promise<void> => {
		previews.delete(machine.home);
		await box(machine).up();
	};

	const pulumiStep: SetupStep = {
		id: "coordinator-pulumi",
		title: "Install Pulumi and log in",
		why: "Pulumi makes the box in your AWS account and keeps its state, in Pulumi Cloud or an S3 bucket of your own.",
		user: "1. Install Pulumi: `brew install pulumi`\n2. Log in: `pulumi login`, or `pulumi login s3://<bucket>` for a backend of your own\n3. Press Next",
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
		why: "The box is a Pulumi project you own, so you can read, change and destroy exactly what it makes.",
		user: "1. Pick a directory for the project, or keep the default\n2. Press Next to write it, with a placeholder on the Pulumi site for each secret\n\nFrom a terminal: `splates server infra init <dir>`",
		agent:
			"Run `splates server infra init <dir>` for the user, in the repo's `packages/infra` unless they name another directory. It fills the host, email, projects and Cloudflare ids from what splates keeps, makes the ESC environment `<org>/splates/secrets` with a placeholder for each secret, which the stack imports, and records the directory in splates's home. splates never sees the secrets: the steps after this one have the user paste each on the Pulumi site.",
		optional: true,
		after: [],
		fields: async (machine) => {
			const placeholder = await infraDir(machine);
			return [
				{
					kind: "text",
					name: "dir",
					label: "Directory for the infra project",
					placeholder,
					optional: placeholder !== undefined,
				},
			];
		},
		doing: "Writing the project and setting its config…",
		submit: async (machine, answers) => {
			if (machine.ps === undefined) {
				throw new Error("setup cannot run Pulumi here");
			}
			const { fs, ps, home, device } = machine;
			const named = String(answers.dir ?? "").trim();
			const chosen = named === "" ? await infraDir(machine) : named;
			if (chosen === undefined) {
				throw new Error("name a directory for the infra project");
			}
			const dir = chosen.replace(/^~(?=\/)/, ps.env("HOME") ?? "~");
			try {
				await infraConfigure({
					dir,
					stack: "prod",
					region: "us-east-1",
					host: "",
					email: "",
					projects: null,
					registered: async () =>
						(
							await Projects.in(
								FsStorage.ofMachine({ fs, ps, log: new MemoryLogger(), home }),
								fs,
							).list()
						).filter((project) => !project.gone),
					creds: {
						credentials: new Credentials([device]),
						request: async () => null,
						save: async () => "device",
					},
					saved: SavedTunnel.in(new FsStorage(home, fs), device),
					fs,
					ps,
					log: new MemoryLogger(),
					fetch: machine.fetch,
				});
				await writeInfraConfig(fs, home, { dir, stack: "prod" });
			} catch (error) {
				throw new Error(error instanceof Error ? error.message : String(error));
			}
		},
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
			removes: async (machine) => {
				const infra = await box(machine).infra();
				return [
					`The stack${infra?.stack === undefined ? "" : ` ${infra.stack}`} from Pulumi, and the record of the project here.`,
				];
			},
			leaves: async (machine) => {
				const infra = await box(machine).infra();
				return [
					`The project's files in ${infra?.dir ?? "its directory"}: delete them yourself.`,
				];
			},
			refused: movedRefusal,
			run: async (machine) => {
				if ((await box(machine).infra()) !== null) {
					await box(machine).remove();
				}
			},
		},
	};

	const secretsStep = stackSecretsStep(infraStep, movedRefusal);

	const remotesStep: SetupStep = {
		id: "coordinator-remotes",
		title: "Give each project an SSH origin",
		why: "The box clones each project, and pushes trunk with a deploy key, over SSH.",
		user: "1. Set each project's `origin` to an SSH URL, as `git@github.com:<owner>/<repo>.git`\n2. Press Next",
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
		why: "A small EC2 instance keeps the page, the queue and merging up while this Mac sleeps. Only SSH reaches it.",
		user: "1. Check what the preview makes and its monthly cost\n2. Press Next to make it, a few minutes",
		agent:
			"Next runs `pulumi up --yes` in the infra project's directory, under its ESC environment, after `pulumi refresh`, so a run after a failed one carries on from what that left. If it fails, the page says what failed: fix that (a secret, by pasting a new one over it on the Pulumi site, where its step here links; a permission, in AWS) and press Next again, which picks up where it stopped. The step is done when `pulumi stack output --json` gives the instance id and tunnel host; `splates server status` prints the box's address. Undoing the area, or `splates server destroy --yes`, unmakes the box and all the stack made, lifting its termination protection itself; the user never runs Pulumi.",
		optional: true,
		after: [accessStep, pulumiStep, infraStep, secretsStep],
		doing: "Making the box with `pulumi up`, a few minutes…",
		detail: async (machine) => {
			if (await coordinatorMoved(machine)) {
				return null;
			}
			let preview = previews.get(machine.home);
			if (preview === undefined) {
				preview = await box(machine)
					.preview()
					.catch(() => "");
				if (preview !== "") {
					previews.set(machine.home, preview);
				}
			}
			return `${preview === "" ? "The stack makes" : `The preview says ${preview}: the stack makes`} the instance, its role, snapshots and creds. That costs about $${BOX_MONTHLY_COST} a month: a t3.medium, its disk and 7 daily snapshots.`;
		},
		submit: async (machine) => {
			await pulumiUp(machine);
		},
		notDone:
			"The stack has made no box yet: press Next to run `pulumi up` in the infra project's directory.",
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
			removes: async (machine) => {
				const standing = await box(machine)
					.status()
					.catch(() => null);
				return [
					`The box${standing === null ? "" : ` at ${standing.ipv4} (${standing.instanceId})`} and everything the stack made: its role, its snapshots and the creds in its Parameter Store, the tunnel and Access application in front of it, and each project's deploy key on GitHub. Anything only on the box is lost.`,
				];
			},
			refused: movedRefusal,
			// The box takes minutes and dollars to make again, and what is only on it goes with it.
			confirm: async (machine) => (await box(machine).infra())?.stack ?? null,
			run: async (machine) => {
				await box(machine).destroy();
			},
		},
	};

	const credsStep: SetupStep = {
		id: "coordinator-creds",
		title: "Give the box its creds",
		why: "The box clones and pushes with a deploy key per project, which the stack keeps in its Parameter Store.",
		user: "1. Press Next to ready each project's clone on the box\n2. If it lists missing creds, press Next again to make them\n\nA secret that fails is pasted again on the Pulumi site, from its step.",
		agent:
			"Run `splates server deploy --dry-run`, which brings the box's splates to this release, and exits `blocked` naming each cred the box's Parameter Store lacks. The stack makes what it lacks: have the user press Next, which runs `pulumi up` first, and run it again until it says the box is ready. A secret a failure names is pasted again on the Pulumi site, through its step.",
		optional: true,
		after: [upStep, remotesStep, tunnelStep],
		doing: "Readying each project's clone on the box, a minute or two…",
		detail: async (machine) => {
			const last = dryRuns.get(machine.home);
			return last?.status === "blocked"
				? `The box's Parameter Store lacks ${last.needs.map((name) => `\`${name}\``).join(", ")}: the stack makes ${last.needs.length === 1 ? "it" : "them"}, so press Next, which runs \`pulumi up\`.`
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
			// A cred set since the last dry run reaches the box only through `pulumi up`.
			if (dryRuns.get(machine.home)?.status === "blocked") {
				await pulumiUp(machine);
			}
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
			"The box lacks creds in its Parameter Store: see the list below, then press Next, which runs `pulumi up` to make them.",
	};

	const moveStep: SetupStep = {
		id: "coordinator-move",
		title: "Deploy the server to its box",
		why: "The server moves to the box and keeps your URL. Agents here checkpoint first, and this Mac stays on as the box's worker.",
		user: "**Next stops the server on this Mac, and this page goes dark** while the box takes over. Every agent here checkpoints first. If the page has not come back in a few minutes, the deploy failed and nothing here changed: run `splates server` on this Mac again and open this step, which shows what the deploy said.\n\n1. Press Next to deploy\n2. Keep this page open: it goes away for a few minutes and comes back served from the box",
		agent:
			"Ask the user first: the deploy stops their `splates server` and every agent in it. Then run `splates server deploy` from a terminal on this Mac, not under `splates server`, which it stops. It prints the box's URL, where the page now is, and the LaunchAgent that keeps this Mac its worker. On a failure it says what to fix and that nothing here changed: start `splates server` again and deploy once it is fixed.",
		optional: true,
		after: [credsStep],
		check: async (machine) =>
			(await coordinatorMoved(machine)) && !(await moveUnfinished(machine)),
		detail: async (machine) =>
			(await moveUnfinished(machine))
				? "The server runs on its box, but this Mac has not joined it as a worker yet: the deploy stopped on its way. Next, or `splates server deploy`, finishes it."
				: await failedMove(machine),
		notDone:
			"The server is not deployed yet: press Next to deploy it, or run `splates server deploy`.",
		// Done only once moved, which refuses every undo.
		undo: {
			removes: async () => [],
			leaves: async () => [
				"This Mac's old tunnel in Cloudflare, no longer reached: delete it in Zero Trust → Networks → Tunnels once the box serves. Its DNS record and Access application were deleted, and the stack's tunnel took their host.",
			],
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
			secretsStep,
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

/**
 * Where the infra project goes unless the user names a directory: a package
 * of the project setup is opened from, so the box is code in the repo, not a
 * repository of its own; none outside a project.
 */
async function infraDir(machine: SetupMachine): Promise<string | undefined> {
	const root = machine.project?.root;
	if (root === undefined) {
		return undefined;
	}
	return (await machine.fs.exists(`${root}/packages`))
		? `${root}/packages/infra`
		: `${root}/infra`;
}
