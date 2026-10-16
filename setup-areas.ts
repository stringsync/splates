import type { Fs } from "webappwiz/system";
import { z } from "zod";
import { OPENAI_KEY } from "./dev-transcriber";
import { Roster } from "./roster";
import { SavedTunnel } from "./saved-tunnel";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";

/**
 * Everything that makes up setting arbor up on a machine, in the order it is
 * best done. Each area is a short list of steps the page and an agent walk
 * the user through one at a time.
 */
export const SETUP_AREAS: readonly SetupArea[] = setupAreas();

/** The roster, its steps named so a later one can wait on an earlier. */
function setupAreas(): readonly SetupArea[] {
	const rosterStep: SetupStep = {
		id: "agent-roster",
		title: "Write the agent roster",
		why: "`arbor dev` starts conversations, and hands out todos, only to the agents on its roster.",
		user: "Say which agents you have installed and signed in.",
		agent:
			"Run `arbor agents` to write the roster to `~/.arbor/agents.json`, then remove the agents the user does not have.",
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
			"Read `arbor agents` back to the user and edit `~/.arbor/agents.json` to list the models they can run.",
		optional: true,
		after: [rosterStep],
		check: async (machine) => {
			const agents = await rosterAgents(machine);
			return (
				agents.length > 0 && agents.every((agent) => agent.models.length > 0)
			);
		},
	};

	const tunnelStep: SetupStep = {
		id: "tunnel",
		title: "Reach arbor dev from elsewhere",
		why: "A tunnel behind Cloudflare Access lets you open `arbor dev` from your phone or another computer, and no one else.",
		user: "Pick the host name and the emails Access lets in.",
		agent:
			"Run `arbor tunnel setup <host> --email <emails>`, requesting its Cloudflare API token as a cred when it asks.",
		optional: true,
		after: [],
		check: async ({ fs, home, device }) => {
			const saved = new SavedTunnel(`${home}/tunnel.json`, {
				fs,
				store: device,
			});
			return (
				(await saved.read()) !== null && (await saved.token()) !== undefined
			);
		},
	};

	const deviceStep: SetupStep = {
		id: "notifications-device",
		title: "Turn notifications on in this browser",
		why: "A push reaches a device only after its browser has asked for them from the page.",
		user: "Turn notifications on in the page's settings, on each device you want them on.",
		agent: "Open the page's notification settings for the user.",
		optional: true,
		after: [],
		check: async ({ fs, home }) => (await pushDevices(fs, home)).length > 0,
	};

	const noticesStep: SetupStep = {
		id: "notifications-notices",
		title: "Choose what you are notified of",
		why: "A device is pushed only the notices it wants, so one that wants none stays silent.",
		user: "Pick, in the page's notification settings, whether an agent waiting or finishing should reach you.",
		agent:
			"Ask the user which notices they want, then have them set it in the page's notification settings.",
		optional: true,
		after: [deviceStep],
		check: async ({ fs, home }) =>
			(await pushDevices(fs, home)).some(
				(device) => device.wants.waiting || device.wants.finished,
			),
	};

	const dictationStep: SetupStep = {
		id: "dictation",
		title: "Dictate prompts",
		why: "The composer's mic transcribes what you say with OpenAI, on a key of your own.",
		user: "Create an OpenAI API key and paste it on the Creds page.",
		agent: `Request it with \`arbor creds request ${OPENAI_KEY} --device\`, with how to get it.`,
		optional: true,
		after: [],
		cred: OPENAI_KEY,
		check: async ({ device }) => (await device.get(OPENAI_KEY)) !== undefined,
	};
	return [
		{ id: "agents", title: "Agents", steps: [rosterStep, modelsStep] },
		{ id: "remote-access", title: "Remote access", steps: [tunnelStep] },
		{
			id: "notifications",
			title: "Notifications",
			steps: [deviceStep, noticesStep],
		},
		{ id: "dictation", title: "Dictation", steps: [dictationStep] },
	];
}

/** What `push.json` keeps of each device, as far as a check needs it. */
const PUSH_DEVICES = z.object({
	devices: z.array(
		z.object({
			wants: z.object({ waiting: z.boolean(), finished: z.boolean() }),
		}),
	),
});

/** The devices `push.json` keeps, none when it is not there. */
async function pushDevices(fs: Fs, home: string) {
	const raw = await fs.read(`${home}/push.json`).catch(() => null);
	return raw === null ? [] : PUSH_DEVICES.parse(JSON.parse(raw)).devices;
}

/** The agents in `agents.json`, none when it is not there, for it holds the defaults then. */
async function rosterAgents({ fs, home }: SetupMachine) {
	const path = `${home}/agents.json`;
	return (await fs.exists(path)) ? new Roster(path, { fs }).agents() : [];
}
