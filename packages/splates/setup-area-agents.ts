import { Roster } from "./roster";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";

/** The roster every agent is started from, and the models it lists. */
export const AGENTS_AREA: SetupArea = agentsArea();

/** The agents in `agents.json`, none when it is not there, for it holds the defaults then. */
export async function rosterAgents({ fs, home }: SetupMachine) {
	const path = `${home}/agents.json`;
	return (await fs.exists(path)) ? new Roster(path, { fs }).agents() : [];
}

function agentsArea(): SetupArea {
	const rosterStep: SetupStep = {
		id: "agent-roster",
		title: "Write the agent roster",
		why: "`splates server` starts conversations, and hands out todos, only to the agents on its roster.",
		user: "Say which agents you have installed and signed in.",
		agent:
			"Run `splates agents` to write the roster to `~/.splates/agents.json`, then remove the agents the user does not have.",
		optional: false,
		after: [],
		check: async (machine) => (await rosterAgents(machine)).length > 0,
	};

	const modelsStep: SetupStep = {
		id: "agent-models",
		title: "List each agent's models",
		why: "An orchestrator picks the cheapest model a todo is worth only from the models the roster lists for each agent.",
		user: "Check that each agent lists the models you can use, and what each is good at.",
		agent:
			"Read `splates agents` back to the user and edit `~/.splates/agents.json` to list the models they can run.",
		optional: true,
		after: [rosterStep],
		check: async (machine) => {
			const agents = await rosterAgents(machine);
			return (
				agents.length > 0 && agents.every((agent) => agent.models.length > 0)
			);
		},
	};

	return { id: "agents", title: "Agents", steps: [rosterStep, modelsStep] };
}
