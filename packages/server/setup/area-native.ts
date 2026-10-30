import { DEFAULT_AGENTS, KIMI_CLI, Roster } from "../models";
import { FsStorage } from "../storage";
import type { StepField } from "./fields";
import type { SetupArea, SetupMachine, SetupStep, StepAnswers } from "./setup";

/** The agents in `agents.json`, none when it is not there, for it holds the defaults then. */
async function rosterAgents({ fs, home }: SetupMachine) {
	const roster = Roster.in(new FsStorage(home, fs));
	return (await fs.exists(`${home}/agents.json`)) ? roster.agents() : [];
}

/** How long a CLI gets to answer before it counts as not answering. */
const PROBE_MS = 10_000;

/** How a CLI is run, installed and signed in, and how the person signs out of it and uninstalls it. */
interface Cli {
	name: string;
	/** The command, ahead of its arguments: the id itself unless it may be off the PATH. */
	command?: string[];
	install: string;
	/** The arguments that exit 0 once it is signed in, and what they print then, when exiting is not enough. */
	signedIn: { args: string[]; says?: string };
	signIn: string;
	/** What the person does to sign out, as "run `x`". */
	signOut: string;
	uninstall: string;
}

/**
 * What each CLI is installed with, asked whether it is signed in, and
 * signed out of and uninstalled with, which only the person does.
 */
const CLIS = {
	claude: {
		name: "Claude",
		install: "curl -fsSL https://claude.ai/install.sh | bash",
		signedIn: { args: ["auth", "status"] },
		signIn: "claude",
		signOut: "run `claude auth logout`",
		uninstall: "rm -f ~/.local/bin/claude && rm -rf ~/.local/share/claude",
	},
	codex: {
		name: "Codex",
		install: "npm install --global @openai/codex",
		signedIn: { args: ["login", "status"] },
		signIn: "codex",
		signOut: "run `codex logout`",
		uninstall: "npm uninstall --global @openai/codex",
	},
	// Kimi has no status command, but signing out takes its provider out of
	// its config, which `provider list` shows; its installer may leave it off the PATH.
	kimi: {
		name: "Kimi",
		command: KIMI_CLI,
		install: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
		signedIn: { args: ["provider", "list"], says: "managed:kimi-code" },
		signIn: "kimi login",
		signOut: "run `kimi` and type `/logout` in it",
		uninstall: "rm -f ~/.kimi-code/bin/kimi",
	},
} satisfies Record<string, Cli>;

type AgentId = keyof typeof CLIS;

/** Claude Code, installed, signed in and on the roster. */
export const CLAUDE_AREA: SetupArea = agentJourney("claude");

/** Codex, installed, signed in and on the roster. */
export const CODEX_AREA: SetupArea = agentJourney("codex");

/** Kimi Code, installed, signed in and on the roster. */
export const KIMI_AREA: SetupArea = agentJourney("kimi");

function agentJourney(id: AgentId): SetupArea {
	const { name, install, signIn: login, signOut, uninstall }: Cli = CLIS[id];
	const signIn: SetupStep = {
		id: `${id}-signin`,
		title: `Install and sign in to ${name}`,
		why: `splates starts ${name} through its own CLI, which has to be installed and signed in on this machine.`,
		user: `Press Next and splates checks that \`${id}\` answers and is signed in. If it is not, install it with \`${install}\`, then run \`${login}\` once to sign in.`,
		agent: `Help set up only ${name}: check \`${id} --version\` and its sign-in status, install it with \`${install}\` if needed, and have the user run \`${login}\` once to sign in. Never collect credentials in chat or send a test prompt.`,
		optional: true,
		after: [],
		doing: `Checking that ${id} answers and is signed in…`,
		check: async (machine) => (await probe(machine, id)) === "ready",
		submit: async (machine) => {
			switch (await probe(machine, id)) {
				case "missing":
					throw new Error(
						`${name} is not installed here: install it with ${install}, then run ${login} once to sign in.`,
					);
				case "signed-out":
					throw new Error(
						`${name} is installed but not signed in: run ${login} once to sign in.`,
					);
				case "ready":
					return;
			}
		},
		// splates installed and signed in nothing, so it takes nothing out.
		undo: {
			removes: async () => [],
			leaves: async () => [
				`${name} stays signed in: ${signOut} to sign out.`,
				`${name} stays installed: run \`${uninstall}\` to remove it.`,
			],
			run: async () => {},
		},
	};
	const models: SetupStep = {
		id: `${id}-models`,
		title: `Choose ${name} models`,
		why: `splates uses the models ticked here for ${name} when assigning work. Ticking one does not prove your account can run it.`,
		user: "Tick the models you can use.",
		agent: `Offer only the default ${id} models; Next writes the ${id} entry of ~/.splates/agents.json, keeping other agents, launch arguments and models. Do not run paid prompts or evals.`,
		optional: true,
		after: [signIn],
		// Read on use: the roster module may still be loading when this file is.
		get fields() {
			return modelFields(id);
		},
		check: async (machine) =>
			(await rosterAgents(machine)).some(
				(agent) => agent.id === id && agent.models.length > 0,
			),
		submit: async ({ fs, home }, answers) => {
			const chosen = chosenModels(id, answers);
			if (chosen.length === 0) {
				throw new Error("Tick at least one model.");
			}
			await Roster.in(new FsStorage(home, fs)).choose(id, chosen);
		},
		undo: {
			removes: async (machine) => {
				const agent = (await rosterAgents(machine)).find(
					(each) => each.id === id,
				);
				const models = (agent?.models ?? []).map((model) => model.name);
				return [
					`${name} on the roster in \`${machine.home}/agents.json\`${models.length === 0 ? "" : `, running ${models.join(", ")}`}`,
				];
			},
			run: ({ fs, home }) => Roster.in(new FsStorage(home, fs)).remove(id),
		},
	};
	return {
		id,
		title: name,
		purpose: `Run agents on ${name}, signed in on this machine.`,
		steps: [signIn, models],
	};
}

/** The field of a model, named so no other agent's collides. */
function modelField(id: AgentId, model: string): string {
	return `${id}-model-${model}`;
}

/** A switch for each model `splates agents` writes for `id`. */
function modelFields(id: AgentId): StepField[] {
	const agent = DEFAULT_AGENTS.find((each) => each.id === id);
	return (agent?.models ?? []).map((model) => ({
		kind: "yes-no",
		name: modelField(id, model.id),
		label: `${model.name}: ${model.strengths}`,
	}));
}

/** The ids of the models the user ticked. */
function chosenModels(id: AgentId, answers: StepAnswers): string[] {
	const agent = DEFAULT_AGENTS.find((each) => each.id === id);
	return (agent?.models ?? [])
		.filter((model) => answers[modelField(id, model.id)] === true)
		.map((model) => model.id);
}

/**
 * Whether `id`'s CLI answers and is signed in, as far as it tells without a
 * prompt sent: its own status command, never a read of its credentials.
 */
async function probe(
	{ ps }: SetupMachine,
	id: AgentId,
): Promise<"missing" | "signed-out" | "ready"> {
	if (ps === undefined) {
		return "missing";
	}
	const { command = [id], signedIn }: Cli = CLIS[id];
	const run = (args: string[]) =>
		ps
			.spawnCapture([...command, ...args], { timeoutMs: PROBE_MS })
			.catch(() => null);
	if ((await run(["--version"]))?.exitCode !== 0) {
		return "missing";
	}
	const status = await run(signedIn.args);
	return status?.exitCode === 0 &&
		(signedIn.says === undefined || status.stdout.includes(signedIn.says))
		? "ready"
		: "signed-out";
}
