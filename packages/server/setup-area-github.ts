import {
	APP_ID,
	APP_KEY,
	GitHubApp,
	type GitHubRepo,
	githubRepo,
} from "./github-app";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";
import { PUSHED_PREFIX } from "./task-branches";

/** Where a GitHub App is made, for the user's own account. */
const NEW_APP_PAGE = "https://github.com/settings/apps/new";

/** The remote the App is installed for before `remote` names one. */
const DEFAULT_REMOTE = "origin";

/**
 * A branch name no ruleset names on its own: whatever rules it has are those
 * a ruleset puts on every branch but the excluded.
 */
const PROBE_BRANCH = "splates-probe/unnamed";

/**
 * The rules that keep a branch from being pushed: made, moved or deleted.
 * A ruleset on trunk carries them, and one on every branch outside
 * `splates/*`, its bypass the coordinator's identity alone.
 */
const PUSH_RULES = ["creation", "update", "deletion"] as const;

/** How to make the rulesets by hand, in the repository's settings. */
const RULESET_HOW = `In this repository's **Settings → Rules → Rulesets**, add two rulesets that are **Active**, restrict creations, updates and deletions, and let only **Repository admin** bypass them, the role of the account \`splates server\` pushes trunk with. One is a branch ruleset that targets **All branches** but excludes \`${PUSHED_PREFIX}*\`. The other is a tag ruleset that targets **All tags**, since the App's contents permission would let a token push or move a release tag.`;

/** The rulesets, as GitHub's REST API makes them. */
const RULESETS = [
	{
		name: "splates",
		target: "branch",
		conditions: {
			ref_name: {
				include: ["~ALL"],
				exclude: [`refs/heads/${PUSHED_PREFIX}*`],
			},
		},
	},
	{
		name: "splates-tags",
		target: "tag",
		conditions: { ref_name: { include: ["~ALL"], exclude: [] } },
	},
].map((each) => ({
	...each,
	enforcement: "active",
	rules: PUSH_RULES.map((type) => ({ type })),
	bypass_actors: [
		{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
	],
}));

/**
 * Pushing each task's branch to the project's GitHub repository, with a
 * GitHub App's token that reaches `splates/*` alone, so a task outlives
 * the machine it runs on. The project's, not the machine's: its steps after
 * the App read the repository setup is opened from.
 */
export const GITHUB_AREA: SetupArea = githubArea();

function githubArea(): SetupArea {
	const appStep: SetupStep = {
		id: "github-app",
		title: "Make the splates GitHub App",
		why: "Workers push each task's branch with an hour-long token the App mints for one repository's contents, never with a credential of yours.",
		user: `[Make a GitHub App](${NEW_APP_PAGE}): any name, Webhook off, Repository permissions **Contents: Read and write** and nothing else, only on this account. Then paste its App ID, and the private key it generates, here.`,
		agent: `Request both as device creds, \`splates creds request ${APP_ID} --device\` and \`splates creds request ${APP_KEY} --device\`, with how to make the App: ${NEW_APP_PAGE}, Webhook off, Contents read and write alone, then the App ID and a generated private key.`,
		optional: true,
		after: [],
		fields: [
			{
				kind: "cred",
				name: APP_ID,
				label: "App ID",
				help: `[Make a GitHub App](${NEW_APP_PAGE}) with Webhook off and Repository permissions **Contents: Read and write** alone, only on this account; its App ID is on its General page.`,
			},
			{
				kind: "cred",
				name: APP_KEY,
				label: "Private key",
				help: "Generate a private key at the foot of its General page, and paste the whole `.pem` file.",
			},
		],
		doing: "Asking GitHub for the App…",
		submit: async (machine) => {
			const app = await keptApp(machine);
			if (app === null) {
				throw new Error("Paste the App ID and its private key first.");
			}
			const about = await app.about().catch(() => {
				throw new Error(
					"GitHub does not know that App ID with that key: paste both again, from the same App.",
				);
			});
			const more = Object.keys(about.permissions).filter(
				(each) => each !== "contents" && each !== "metadata",
			);
			if (more.length > 0) {
				throw new Error(
					`The App may do more than push contents (${more.join(", ")}): take those permissions off on its page, then press Next.`,
				);
			}
		},
		check: async ({ device }) =>
			(await device.get(APP_ID)) !== undefined &&
			(await device.get(APP_KEY)) !== undefined,
	};

	const installStep: SetupStep = {
		id: "github-install",
		title: "Install the App on this repository",
		why: "The App mints tokens only for a repository it is installed on.",
		user: "Install the App from its page on GitHub, picking **Only select repositories** and this project's repository alone, then press Next, which links the page if it is not installed yet.",
		agent:
			"Run `splates setup github-install`, whose problem names the App's install page, and have the user install it there on this repository alone.",
		notDone:
			"The App is not installed on this repository yet: install it, then press Next.",
		optional: true,
		after: [appStep],
		check: async (machine) => {
			const app = await keptApp(machine);
			if (app === null) {
				return false;
			}
			const repo = await projectRepo(machine);
			if (await app.installed(repo)) {
				return true;
			}
			const { slug } = await app.about();
			throw new Error(
				`Not installed on ${repo.owner}/${repo.name}: install it from https://github.com/apps/${slug}/installations/new`,
			);
		},
	};

	const rulesetStep: SetupStep = {
		id: "github-ruleset",
		title: "Keep the App to splates branches, and off tags",
		why: `A ruleset is what keeps the App's tokens, which workers push with, to \`${PUSHED_PREFIX}*\`: without one they could push trunk or a release tag.`,
		user: RULESET_HOW,
		agent: `Once the user agrees, make both with their own GitHub sign-in (\`gh auth status\`): \`gh api --method POST repos/<owner>/<repo>/rulesets --input -\` once with each of ${RULESETS.map((each) => `\`${JSON.stringify(each)}\``).join(" and ")}, the bypass being the Repository admin role. Then run \`splates setup github-ruleset\`.`,
		notDone:
			"The rulesets do not cover trunk, every other branch and every tag yet: make them, then press Next.",
		optional: true,
		after: [installStep],
		check: async (machine) => {
			const app = await keptApp(machine);
			if (app === null) {
				return false;
			}
			const repo = await projectRepo(machine);
			const { trunk } = await requireProject(machine).config();
			const token = await app.token(repo);
			const kept = async (branch: string) => {
				const rules = await app.rules(repo, branch, token);
				return PUSH_RULES.every((rule) => rules.includes(rule));
			};
			if (!(await kept(trunk)) || !(await kept(PROBE_BRANCH))) {
				return false;
			}
			if (await kept(`${PUSHED_PREFIX}probe`)) {
				throw new Error(
					`The ruleset covers \`${PUSHED_PREFIX}*\` too: exclude it, or workers cannot push their branches.`,
				);
			}
			return app.tagsRestricted(repo, PUSH_RULES, token);
		},
	};

	const pushStep: SetupStep = {
		id: "github-push",
		title: "Turn pushing on",
		why: "With a remote named, each task's branch is pushed after every commit and checkpoint, and trunk becomes the remote's, which only `splates server` pushes.",
		user: 'Add `remote: "origin"` to this project\'s `splates.config.ts` and merge it, as a task, then press Next.',
		agent:
			'In a task of its own, add `remote: "origin"` to `splates.config.ts` and merge it; then run `splates setup github-push`.',
		notDone:
			"`splates.config.ts` names no `remote` yet: add it, merge it, then press Next.",
		optional: true,
		after: [rulesetStep],
		check: async (machine) =>
			(await requireProject(machine).config()).remote !== null,
	};

	return {
		id: "github",
		title: "GitHub pushing",
		steps: [appStep, installStep, rulesetStep, pushStep],
	};
}

/** The App the device keeps, or null until both its creds are. */
async function keptApp({
	device,
	fetch,
}: SetupMachine): Promise<GitHubApp | null> {
	const id = await device.get(APP_ID);
	const key = await device.get(APP_KEY);
	return id === undefined || key === undefined
		? null
		: new GitHubApp(id, key, { fetch });
}

/** The project setup is opened from, or a throw saying there is none. */
function requireProject({ project }: SetupMachine) {
	if (project === undefined) {
		throw new Error(
			"No project to check: open Setup from a project, or run `splates setup` in its repository.",
		);
	}
	return project;
}

/** The github.com repository the project pushes to, or a throw saying why not. */
async function projectRepo(machine: SetupMachine): Promise<GitHubRepo> {
	const project = requireProject(machine);
	const remote = (await project.config()).remote ?? DEFAULT_REMOTE;
	const url = await project.remoteUrl(remote);
	if (url === null) {
		throw new Error(`This repository has no remote \`${remote}\`.`);
	}
	const repo = githubRepo(url);
	if (repo === null) {
		throw new Error(
			`\`${remote}\` is not on github.com, where the App pushes: ${url}`,
		);
	}
	return repo;
}
