import { CoordinatorBox, coordinatorMoved, pulumiOrg } from "../coordinator";
import type { DeployKeyProject } from "../infra/deploy-keys";
import { githubOwnerOf, secretsOf } from "../infra/init";
import {
	SECRETS_ENVIRONMENT,
	secretHelp,
	secretsEnvironmentIn,
	secretsEnvironmentUrl,
	secretsSet,
} from "../infra/secrets";
import type { SetupMachine, SetupStep } from "./setup";

/**
 * The stack's secrets, which the user pastes on the Pulumi site: a step that
 * stands for one per secret the stack reads, a GitHub token per owner among
 * them, each saying how to get it and done once Pulumi no longer holds its
 * placeholder. splates never reads a value. `after` is the step that writes
 * the infra project and makes the environment; `refused` says why undoing
 * will not go.
 */
export function stackSecretsStep(
	after: SetupStep,
	refused: (machine: SetupMachine) => Promise<string | null>,
): SetupStep {
	const secretsStep: SetupStep = {
		id: "coordinator-secrets",
		title: "Paste the stack's secrets into Pulumi",
		why: "The stack reads its tokens from a Pulumi ESC environment, which splates never reads.",
		user: "1. Paste each secret on the Pulumi site, a step each\n2. Press Next once all are in",
		agent:
			"Stands for one step per secret, which the roster lists in its place.",
		optional: true,
		after: [after],
		each: async (machine) => {
			const { keys, org, set, projects } = await secretsHere(machine);
			return keys.map((key) => secretStep(key, org, set, projects));
		},
		check: async (machine) => {
			if (await coordinatorMoved(machine)) {
				return true;
			}
			const { keys, set } = await secretsHere(machine);
			return set !== null && keys.every((key) => set.get(key) === true);
		},
		undo: {
			removes: async () => [],
			leaves: async (machine) => {
				const org = machine.ps && (await pulumiOrg(machine.ps));
				return [
					`The secrets you pasted on the Pulumi site: \`pulumi env rm ${org ?? "<org>"}/${SECRETS_ENVIRONMENT}\` removes them, and revoke each token where you made it.`,
				];
			},
			refused,
			run: async () => {},
		},
	};

	/** One secret's step: how to get it and where on the Pulumi site it goes, done once it is no longer the placeholder. */
	const secretStep = (
		key: string,
		org: string | null,
		set: ReadonlyMap<string, boolean> | null,
		projects: readonly DeployKeyProject[],
	): SetupStep => {
		const help = secretHelp(key, projects);
		const where =
			org === null
				? "the ESC environment `splates/secrets` on the Pulumi site"
				: `[${secretsEnvironmentIn(org)}](${secretsEnvironmentUrl(org)}) on the Pulumi site`;
		return {
			id: `coordinator-secret-${secretSlug(key)}`,
			title: `Paste ${help.name} into Pulumi`,
			why: help.purpose,
			user: [
				...help.instructions,
				`Open ${where}`,
				`Replace the placeholder at \`pulumiConfig\` › \`${key}\` with it, as a secret, and save`,
				"Press Next",
			]
				.map((each, index) => `${index + 1}. ${each}`)
				.join("\n"),
			agent: `The user pastes ${help.name} on the Pulumi site; splates never sees it, so never ask for it. Next reads the environment's definition without \`--show-secrets\` and is done once \`pulumiConfig.${key}\` is no longer the placeholder. To replace a token that failed, the user pastes a new one over it the same way.`,
			optional: true,
			after: [after],
			of: secretsStep,
			check: async (machine) =>
				(await coordinatorMoved(machine)) || set?.get(key) === true,
			detail: async () =>
				set === null
					? "The environment is not on the Pulumi site yet: Write the infra project makes it."
					: set.get(key) === true
						? `Pulumi holds ${help.name}. To replace it, paste a new one over it the same way.`
						: null,
			notDone: `Pulumi still has the placeholder for \`${key}\`: paste ${help.name} over it as a secret and save, then press Next.`,
		};
	};

	return secretsStep;
}

/**
 * The secrets the stack reads, for the projects in its config, and which the
 * ESC environment holds; before the project is written, those every stack reads.
 */
async function secretsHere(machine: SetupMachine): Promise<{
	keys: string[];
	org: string | null;
	set: Map<string, boolean> | null;
	projects: DeployKeyProject[];
}> {
	const infra = await new CoordinatorBox({
		fs: machine.fs,
		home: machine.home,
		...(machine.ps === undefined ? {} : { ps: machine.ps }),
	}).infra();
	const projects =
		infra === null
			? []
			: await stackProjects(
					machine,
					`${infra.dir}/Pulumi.${infra.stack ?? "prod"}.yaml`,
				);
	const org = machine.ps ? await pulumiOrg(machine.ps) : null;
	return {
		keys: secretsOf(projects),
		org,
		set: org === null || !machine.ps ? null : await secretsSet(machine.ps, org),
		projects,
	};
}

/** The projects a stack's config pushes, as `splates:projects` lists them. */
async function stackProjects(
	machine: SetupMachine,
	path: string,
): Promise<DeployKeyProject[]> {
	if (!(await machine.fs.exists(path))) {
		return [];
	}
	const parsed = Bun.YAML.parse(await machine.fs.read(path)) as {
		config?: Record<string, unknown>;
	} | null;
	const listed = parsed?.config?.["splates:projects"];
	return (Array.isArray(listed) ? listed : []).flatMap((each) => {
		const { slug, repository } = (each ?? {}) as Record<string, unknown>;
		return typeof slug === "string" &&
			typeof repository === "string" &&
			repository.includes("/")
			? [{ slug, repository }]
			: [];
	});
}

/** The part of a secret's step id that names it: `cloudflare`, `anthropic`, or `github-<owner>`. */
function secretSlug(key: string): string {
	const owner = githubOwnerOf(key);
	if (owner !== null) {
		return `github-${owner.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
	}
	return key === "cloudflare:apiToken" ? "cloudflare" : "anthropic";
}
