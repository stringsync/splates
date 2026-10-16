import { z } from "zod";
import { OPENAI_KEY } from "./dev-transcriber";
import { SavedTunnel } from "./saved-tunnel";
import type { SetupArea, SetupStep } from "./setup";

/**
 * Everything that makes up setting arbor up on a machine, in the order it is
 * best done. Each area is a short list of steps the page and an agent walk
 * the user through one at a time.
 */
export const SETUP_AREAS: readonly SetupArea[] = setupAreas();

/** The roster, its steps named so a later one can wait on an earlier. */
function setupAreas(): readonly SetupArea[] {
	const agentsStep: SetupStep = {
		id: "agents",
		title: "Choose the agents arbor starts",
		why: "`arbor dev` starts conversations, and hands out todos, only with the agents on its roster.",
		user: "Say which agents you have installed and signed in, and which should be the default.",
		agent:
			"Run `arbor agents` to write the roster to `~/.arbor/agents.json`, then edit it to match.",
		optional: false,
		after: [],
		check: async ({ fs, home }) => fs.exists(`${home}/agents.json`),
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

	const notificationsStep: SetupStep = {
		id: "notifications",
		title: "Get notified when an agent needs you",
		why: "A push reaches your device when an agent comes to wait or finishes, even with the page closed.",
		user: "Turn notifications on from the page's settings, on each device you want them on.",
		agent: "Open the page's notification settings for the user.",
		optional: true,
		after: [],
		check: async ({ fs, home }) => {
			const raw = await fs.read(`${home}/push.json`).catch(() => null);
			if (raw === null) {
				return false;
			}
			return PUSH_DEVICES.parse(JSON.parse(raw)).devices.length > 0;
		},
	};

	const dictationStep: SetupStep = {
		id: "dictation",
		title: "Dictate prompts",
		why: "The mic in the composer transcribes what you say with OpenAI, on your own key.",
		user: "Create an OpenAI API key and paste it on the Creds page.",
		agent: `Request it with \`arbor creds request ${OPENAI_KEY} --device\`, with how to get it.`,
		optional: true,
		after: [],
		check: async ({ device }) => (await device.get(OPENAI_KEY)) !== undefined,
	};
	return [
		{ id: "agents", title: "Agents", steps: [agentsStep] },
		{ id: "remote-access", title: "Remote access", steps: [tunnelStep] },
		{ id: "notifications", title: "Notifications", steps: [notificationsStep] },
		{ id: "dictation", title: "Dictation", steps: [dictationStep] },
	];
}

/** What `push.json` keeps of each device, as far as a check needs it. */
const PUSH_DEVICES = z.object({ devices: z.array(z.unknown()) });
