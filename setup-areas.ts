import type { Fs } from "webappwiz/system";
import { z } from "zod";
import { OPENAI_KEY } from "./dev-transcriber";
import { Roster } from "./roster";
import { SavedTunnel, type TunnelRecord } from "./saved-tunnel";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";
import { SLOT_POOL } from "./slots";
import { API_TOKEN, TOKEN_PERMISSIONS, TOKENS_PAGE } from "./tunnel-setup";

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

	const tokenStep: SetupStep = {
		id: "cloudflare-token",
		title: "Give arbor a Cloudflare API token",
		why: "To reach `arbor dev` from your phone or another computer, arbor makes a Cloudflare tunnel with Cloudflare Access in front, through Cloudflare's API.",
		user: `Create a [Cloudflare API token](${TOKENS_PAGE}) with ${TOKEN_PERMISSIONS.join(", ")}, for your account and your zone, and paste it here. Skip to keep \`arbor dev\` on this machine only, or to run your own \`TunnelProvider\` from \`arbor.config.ts\`.`,
		agent: `Request it with \`arbor creds request ${API_TOKEN} --device\`, with how to make it, or let \`arbor tunnel setup\` request it.`,
		optional: true,
		after: [],
		cred: API_TOKEN,
		check: async ({ device }) => (await device.get(API_TOKEN)) !== undefined,
	};

	const tunnelStep: SetupStep = {
		id: "tunnel",
		title: "Make the tunnel",
		why: "The tunnel carries a host name of yours to `arbor dev`, and Access lets in only the emails you name.",
		user: "Pick the host name, in a zone of your account, and the emails Access lets in.",
		agent:
			"Run `arbor tunnel setup <host> --email <emails>`, adding `--team <name>` when the account has no Zero Trust organization yet.",
		optional: true,
		after: [tokenStep],
		check: async (machine) => (await savedTunnel(machine)) !== null,
	};

	const accessStep: SetupStep = {
		id: "access",
		title: "Check that Access lets only you in",
		why: "Access is the one thing between the internet and agents that run commands on this machine.",
		user: "Open the host on your phone and sign in with an email you named; restart `arbor dev` first if it ran before the tunnel was made.",
		agent:
			"Run `arbor tunnel status`, then have the user open the host and sign in, and check this step again.",
		optional: true,
		after: [tunnelStep],
		check: async (machine) => {
			const saved = await savedTunnel(machine);
			return saved !== null && guarded(saved, machine.fetch ?? fetch);
		},
	};

	const slotsStep: SetupStep = {
		id: "slot-tunnels",
		title: "Serve a task's checkout at a host of its own",
		why: "`arbor dev --slot` serves a task's worktree at `<word>.<zone>`, behind the same Access, so you can try a change on your phone before it lands.",
		user: "Nothing but to say yes: an agent runs it when it has a change to show you.",
		agent:
			"Run `arbor dev --slot` from a task's worktree, which makes the slot's tunnel the first time.",
		optional: true,
		after: [accessStep],
		check: async ({ fs, home }) => {
			for (const { word } of SLOT_POOL) {
				if (await fs.exists(`${home}/slots/${word}/tunnel.json`)) {
					return true;
				}
			}
			return false;
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
	const installStep: SetupStep = {
		id: "opencode-install",
		title: "Install OpenCode",
		why: "Optionally add OpenCode alongside your existing agents.",
		user: "Check this machine, or install OpenCode here with npm. No model prompt is sent.",
		agent:
			"Use the native OpenCode controls in Setup; do not start a paid conversation or edit the roster.",
		optional: true,
		after: [],
		check: async ({ opencode }) => opencode?.read().version != null,
	};
	const connectStep: SetupStep = {
		id: "opencode-connect",
		title: "Connect OpenCode Go",
		why: "Connect your existing Go or Go Plus account through OpenCode's own secure login.",
		user: "Open your existing account in Console, then enter its key only into the native login prompt below. Return here and check again.",
		agent:
			"Never ask for keys in chat or read native credential files. Native auth listing confirms only stored credentials; ACP initialize checks protocol compatibility, not entitlement or billing.",
		optional: true,
		after: [installStep],
		check: async ({ opencode }) =>
			opencode?.read().auth === "stored" &&
			opencode.read().protocol === "compatible" &&
			opencode.read().problem === null,
	};
	const openCodeModelsStep: SetupStep = {
		id: "opencode-models",
		title: "Choose OpenCode Go models",
		why: "Select exact Go models and review an experiment-only configuration.",
		user: "Refresh available models, choose main and auxiliary models, then confirm Use balance is off in Console before applying.",
		agent:
			"Use the native model controls; no prompts or credential exports. Saved configuration is not proof of inference or billing.",
		optional: true,
		after: [connectStep],
		check: async ({ opencode }) =>
			(await opencode?.models.recipes.stored().catch(() => null)) != null,
	};
	const openCodeReadyStep: SetupStep = {
		id: "opencode-ready",
		title: "Check OpenCode configuration",
		why: "Verify the saved recipe for a new conversation in this project.",
		user: "Check configuration, then open a new conversation on your selected main model.",
		agent:
			"Metadata and ACP initialize only. Never send a paid test prompt or claim billing is verified.",
		optional: true,
		after: [openCodeModelsStep],
		check: async () => false,
	};

	return [
		{ id: "agents", title: "Agents", steps: [rosterStep, modelsStep] },
		{
			id: "opencode",
			title: "OpenCode",
			steps: [installStep, connectStep, openCodeModelsStep, openCodeReadyStep],
		},
		{
			id: "remote-access",
			title: "Remote access",
			steps: [tokenStep, tunnelStep, accessStep, slotsStep],
		},
		{
			id: "notifications",
			title: "Notifications",
			steps: [deviceStep, noticesStep],
		},
		{ id: "dictation", title: "Dictation", steps: [dictationStep] },
		...(["claude", "codex"] as const).map(agentJourney),
	];
}

/** These checks describe the saved roster, never native login or entitlement. */
function agentJourney(id: "claude" | "codex"): SetupArea {
	const name = id === "claude" ? "Claude" : "Codex";
	const instructions =
		id === "claude"
			? "https://code.claude.com/docs/en/quickstart"
			: "https://developers.openai.com/codex/cli/";
	const register: SetupStep = {
		id: `${id}-roster`,
		title: `Register ${name} in arbor`,
		why: `Prepare ${name} on this machine, then make it available to arbor. The check below only reads its saved roster entry; it does not verify installation or login.`,
		user: `Install the ${name} CLI using its [official setup instructions](${instructions}), then run \`${id}\` in a terminal on this machine and complete its sign-in. Do not paste credentials into chat. Run \`arbor agents\` and review only the \`${id}\` entry in \`~/.arbor/agents.json\`, preserving other agents and defaults.`,
		agent: `Help set up only ${name}: inspect its installation, use official installation instructions if needed, and have the user sign in through its native CLI. Never collect credentials in chat or send a test prompt. Review only the ${id} entry in ~/.arbor/agents.json; preserve other agents, custom launch arguments, models and defaults. This step's check observes only a saved roster entry, not authentication.`,
		optional: true,
		after: [],
		check: async (machine) =>
			(await rosterAgents(machine)).some((agent) => agent.id === id),
	};
	const models: SetupStep = {
		id: `${id}-models`,
		title: `Review ${name} models`,
		why: `arbor uses the models listed for ${name} when assigning work. Saved models do not prove account access or billing.`,
		user: `Run \`arbor agents\` and review the models for \`${id}\` in \`~/.arbor/agents.json\`. Keep the models you can use and describe their strengths and cost. To repair setup, revisit the first step; leave other agents and defaults unchanged.`,
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

/** The tunnel `arbor tunnel setup` saved, when its token is kept too. */
async function savedTunnel({
	fs,
	home,
	device,
}: SetupMachine): Promise<TunnelRecord | null> {
	const saved = new SavedTunnel(`${home}/tunnel.json`, { fs, store: device });
	const record = await saved.read();
	return record !== null && (await saved.token()) !== undefined ? record : null;
}

/** How long Access gets to answer before the check gives up. */
const ACCESS_TIMEOUT = 5000;

/**
 * Whether the tunnel's host, asked without a sign-in, sends the asker to the
 * team's Access login rather than to the page. Throws, saying why, when the
 * host does not answer or answers with the page itself.
 */
async function guarded(
	{ host, team }: TunnelRecord,
	fetch: typeof globalThis.fetch,
): Promise<boolean> {
	const response = await fetch(`https://${host}/`, {
		redirect: "manual",
		signal: AbortSignal.timeout(ACCESS_TIMEOUT),
	}).catch((error: Error) => {
		throw new Error(`https://${host} did not answer: ${error.message}`);
	});
	const location = response.headers.get("location") ?? "";
	if (location.includes(`${team}.cloudflareaccess.com`)) {
		return true;
	}
	if (response.ok) {
		throw new Error(
			`https://${host} served the page without a sign-in: Access is not in front of it`,
		);
	}
	return false;
}
