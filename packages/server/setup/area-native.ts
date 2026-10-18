import { DEFAULT_AGENTS, Roster } from "../roster";
import type {
	SetupArea,
	SetupMachine,
	SetupStep,
	StepAnswers,
	StepField,
} from "./setup";

/** The agents in `agents.json`, none when it is not there, for it holds the defaults then. */
async function _rosterAgents({ fs, home }: SetupMachine) {
	const path = `${home}/agents.json`;
	return (await fs.exists(path)) ? new Roster(path, { fs }).agents() : [];
}

/** The agents in `agents.json`, none when it is not there, for it holds the defaults then. */
async function rosterAgents({ fs, home }: SetupMachine) {
	const path = `${home}/agents.json`;
	return (await fs.exists(path)) ? new Roster(path, { fs }).agents() : [];
}

/** How long a CLI gets to answer before it counts as not answering. */
const PROBE_MS = 10_000;

/** What each CLI is installed with, and asked whether it is signed in. */
const CLIS = {
	claude: {
		name: "Claude",
		install: "curl -fsSL https://claude.ai/install.sh | bash",
		signedIn: ["claude", "auth", "status"],
	},
	codex: {
		name: "Codex",
		install: "npm install --global @openai/codex",
		signedIn: ["codex", "login", "status"],
	},
};

type AgentId = keyof typeof CLIS;

/** Claude Code, installed, signed in and on the roster. */
export const CLAUDE_AREA: SetupArea = agentJourney("claude");

/** Codex, installed, signed in and on the roster. */
export const CODEX_AREA: SetupArea = agentJourney("codex");

function agentJourney(id: AgentId): SetupArea {
	const { name, install } = CLIS[id];
	const signIn: SetupStep = {
		id: `${id}-signin`,
		title: `Install and sign in to ${name}`,
		why: `splates starts ${name} through its own CLI, which has to be installed and signed in on this machine.`,
		user: `Press Next and splates checks that \`${id}\` answers and is signed in. If it is not, install it with \`${install}\`, then run \`${id}\` once to sign in.`,
		agent: `Help set up only ${name}: check \`${id} --version\` and its sign-in status, install it with \`${install}\` if needed, and have the user run \`${id}\` once to sign in. Never collect credentials in chat or send a test prompt.`,
		optional: true,
		after: [],
		doing: `Checking that ${id} answers and is signed in…`,
		check: async (machine) => (await probe(machine, id)) === "ready",
		submit: async (machine) => {
			switch (await probe(machine, id)) {
				case "missing":
					throw new Error(
						`${name} is not installed here: install it with ${install}, then run ${id} once to sign in.`,
					);
				case "signed-out":
					throw new Error(
						`${name} is installed but not signed in: run ${id} once to sign in.`,
					);
				case "ready":
					return;
			}
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
		fields: modelFields(id),
		check: async (machine) =>
			(await rosterAgents(machine)).some(
				(agent) => agent.id === id && agent.models.length > 0,
			),
		submit: async ({ fs, home }, answers) => {
			const chosen = chosenModels(id, answers);
			if (chosen.length === 0) {
				throw new Error("Tick at least one model.");
			}
			await new Roster(`${home}/agents.json`, { fs }).choose(id, chosen);
		},
	};
	return { id, title: name, steps: [signIn, models] };
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
	const ran = async (argv: string[]) =>
		(await ps.spawnCapture(argv, { timeoutMs: PROBE_MS }).catch(() => null))
			?.exitCode === 0;
	if (!(await ran([id, "--version"]))) {
		return "missing";
	}
	return (await ran(CLIS[id].signedIn)) ? "ready" : "signed-out";
}
