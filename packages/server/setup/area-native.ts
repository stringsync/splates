import { DEFAULT_AGENTS, KIMI_CLI, Roster } from "../models";
import { FsStorage } from "../storage";
import type { StepField } from "./fields";
import { probed } from "./probes";
import type { SetupArea, SetupMachine, SetupStep, StepAnswers } from "./setup";

/** The agents in `agents.json`, none when it is not there, for it holds the defaults then. */
async function rosterAgents({ fs, home }: SetupMachine) {
	const roster = Roster.in(new FsStorage(home, fs));
	return (await fs.exists(`${home}/agents.json`)) ? roster.agents() : [];
}

/** How long a CLI gets to answer before it counts as not answering. */
const PROBE_MS = 10_000;

/** How long an install gets before it counts as failed. */
const INSTALL_MS = 10 * 60_000;

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
	const installStep: SetupStep = {
		id: `${id}-install`,
		title: `Install ${name}`,
		why: `splates starts ${name} through its own CLI, which has to be installed on this machine. One agent is enough, so skip the ones you will not use.`,
		user: `${name} is not on this machine yet. Next installs it with \`${install}\`.`,
		agent: `Press Next on the page, or run \`${install}\`. Do not sign in for the user or send a test prompt.`,
		optional: true,
		after: [],
		doing: `Installing ${name}…`,
		check: async (machine) => (await probe(machine, id)) !== "missing",
		submit: async (machine) => {
			const { ps } = machine;
			const result = await ps
				?.spawnCapture(["sh", "-c", install], {
					timeoutMs: INSTALL_MS,
					stdin: "",
				})
				.catch(() => null);
			if (result?.exitCode !== 0) {
				throw new Error(
					`Could not install ${name} from here. Run \`${install}\` in a terminal to see why, then press Next.`,
				);
			}
			if ((await probe(machine, id)) === "missing") {
				throw new Error(
					`${name} installed, but splates cannot find it on its PATH. Restart \`splates server\`, then press Next.`,
				);
			}
		},
		// Other tools may use it, so only the person takes it out.
		undo: {
			removes: async () => [],
			leaves: async () => [
				`${name} stays installed: run \`${uninstall}\` to remove it.`,
			],
			run: async () => {},
		},
	};
	const signIn: SetupStep = {
		id: `${id}-signin`,
		title: `Sign in to ${name}`,
		why: `${name} has to be signed in on this machine, which only you can do.`,
		user: `Run \`${login}\` once in a terminal and sign in. This page notices when you have, then press Next.`,
		agent: `Help set up only ${name}: check \`${id} --version\` and its sign-in status, install it with \`${install}\` if needed, and have the user run \`${login}\` once to sign in. Never collect credentials in chat or send a test prompt.`,
		optional: true,
		after: [installStep],
		doing: `Checking that ${id} answers and is signed in…`,
		check: async (machine) => (await probe(machine, id)) === "ready",
		found: async ({ ps }) => {
			const { command = [id] }: Cli = CLIS[id];
			const version = (
				await ps?.spawnCapture([...command, "--version"], {
					timeoutMs: PROBE_MS,
				})
			)?.stdout.trim();
			return version
				? `${name} ${version} is installed and signed in.`
				: `${name} is installed and signed in.`;
		},
		submit: async (machine) => {
			switch (await probe(machine, id)) {
				case "missing":
					throw new Error(
						`${name} is not installed here: go back and install it with ${install}.`,
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
			leaves: async () => [`${name} stays signed in: ${signOut} to sign out.`],
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
		found: async (machine) => {
			const models =
				(await rosterAgents(machine)).find((agent) => agent.id === id)
					?.models ?? [];
			return `${models.length} ${models.length === 1 ? "model is" : "models are"} on the roster: ${models.map((model) => model.name).join(", ")}.`;
		},
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
		steps: [installStep, signIn, models],
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
function probe(
	machine: SetupMachine,
	id: AgentId,
): Promise<"missing" | "signed-out" | "ready"> {
	return probed(machine, id, () => probeNow(machine, id));
}

async function probeNow(
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
