import { modelsOf, Roster } from "../models";
import type {
	SetupArea,
	SetupMachine,
	SetupProject,
	SetupStep,
	StepOption,
} from "./setup";

/**
 * The project's groomer: built-in automation `groomer`, off until this step
 * turns it on, which organizes each task added to the backlog rough and
 * marks it ready, never doing it. The project's, not the machine's, kept
 * in its `.git/splates/hooks.json`, since it spends the person's tokens.
 */
const groomerStep: SetupStep = {
	id: "groomer",
	title: "Turn on the groomer",
	why: "A task deferred rough waits in the backlog until someone grooms it: the groomer checks no other task asks it, splits one too big, links what blocks it and picks its lane, then marks it ready, so you only queue it.",
	user: "Pick the agent and model the groomer runs as, then press Next. It grooms one task at a time in a conversation of its own; turn it off from the Automations page.",
	agent:
		"Have the user pick on the page, or ask which agent and model and run `splates hook groomer --agent <agent> --model <model>` in the project's main tree. `splates hook groomer --off` turns it off.",
	optional: true,
	after: [],
	fields: [
		{
			kind: "choice",
			name: "pick",
			label: "Agent and model",
			options: picks,
		},
	],
	check: async (machine) => (await requireProject(machine).groomer()) !== null,
	submit: async (machine, answers) => {
		const [agent = "", model] = String(answers.pick).split("/");
		if (agent === "") {
			throw new Error("Pick the agent and model the groomer runs as.");
		}
		await requireProject(machine).setGroomer(
			model === undefined ? { agent } : { agent, model },
		);
	},
	doing: "Turning the groomer on…",
	notDone:
		"The groomer is still off. Pick its agent and model, then press Next.",
};

/** Grooming the backlog, for the project Setup is opened from. */
export const GROOMING_AREA: SetupArea = {
	id: "grooming",
	title: "Grooming",
	steps: [groomerStep],
};

/** Each model of each agent on the roster, as `agent/model`, the cheapest first. */
async function picks({ fs, home }: SetupMachine): Promise<StepOption[]> {
	const agents = await new Roster(`${home}/agents.json`, { fs }).agents();
	return agents.flatMap((agent) => {
		const models = [...modelsOf(agent)].sort(
			(one, other) => (one.costRank ?? 0) - (other.costRank ?? 0),
		);
		return models.length === 0
			? [{ value: agent.id, label: agent.name }]
			: models.map((model) => ({
					value: `${agent.id}/${model.id}`,
					label: `${agent.name} ${model.name}, ${model.cost}`,
				}));
	});
}

/** The project setup is opened from, or a throw saying there is none. */
function requireProject({ project }: SetupMachine): SetupProject {
	if (project === undefined) {
		throw new Error(
			"No project to groom: open Setup from a project, or run `splates setup` in its repository.",
		);
	}
	return project;
}
