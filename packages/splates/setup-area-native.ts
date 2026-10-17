import type { SetupArea, SetupStep } from "./setup";
import { rosterAgents } from "./setup-area-agents";

/** Claude Code, installed, signed in and on the roster. */
export const CLAUDE_AREA: SetupArea = agentJourney("claude");

/** Codex, installed, signed in and on the roster. */
export const CODEX_AREA: SetupArea = agentJourney("codex");

/** These checks describe the saved roster, never native login or entitlement. */
function agentJourney(id: "claude" | "codex"): SetupArea {
	const name = id === "claude" ? "Claude" : "Codex";
	const instructions =
		id === "claude"
			? "https://code.claude.com/docs/en/quickstart"
			: "https://developers.openai.com/codex/cli/";
	const register: SetupStep = {
		id: `${id}-roster`,
		title: `Register ${name} in splates`,
		why: `Prepare ${name} on this machine, then make it available to splates. The check below only reads its saved roster entry; it does not verify installation or login.`,
		user: `Install the ${name} CLI using its [official setup instructions](${instructions}), then run \`${id}\` in a terminal on this machine and complete its sign-in. Do not paste credentials into chat. Run \`splates agents\` and review only the \`${id}\` entry in \`~/.splates/agents.json\`, preserving other agents and defaults.`,
		agent: `Help set up only ${name}: inspect its installation, use official installation instructions if needed, and have the user sign in through its native CLI. Never collect credentials in chat or send a test prompt. Review only the ${id} entry in ~/.splates/agents.json; preserve other agents, custom launch arguments, models and defaults. This step's check observes only a saved roster entry, not authentication.`,
		optional: true,
		after: [],
		check: async (machine) =>
			(await rosterAgents(machine)).some((agent) => agent.id === id),
	};
	const models: SetupStep = {
		id: `${id}-models`,
		title: `Review ${name} models`,
		why: `splates uses the models listed for ${name} when assigning work. Saved models do not prove account access or billing.`,
		user: `Run \`splates agents\` and review the models for \`${id}\` in \`~/.splates/agents.json\`. Keep the models you can use and describe their strengths and cost. To repair setup, revisit the first step; leave other agents and defaults unchanged.`,
		agent: `Review only ${id}'s models with the user. Preserve other entries, existing custom launch arguments and defaults. Do not run paid prompts or evals.`,
		optional: true,
		after: [register],
		check: async (machine) =>
			(await rosterAgents(machine)).some(
				(agent) => agent.id === id && agent.models.length > 0,
			),
	};
	return { id, title: name, steps: [register, models] };
}
