import { Credentials } from "webappwiz/creds";
import { MemoryLogger } from "webappwiz/log";
import { portsHostFlag, SavedPortsHost } from "../saved-ports-host";
import { SavedTunnel, type TunnelRecord } from "../saved-tunnel";
import {
	API_TOKEN,
	TOKEN_PERMISSIONS,
	TOKENS_PAGE,
	tokenInstructions,
	tunnelSetup,
} from "../tunnel-setup";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";

/** Reaching `splates server` from a phone or another computer, behind Access. */
export const REMOTE_ACCESS_AREA: SetupArea = remoteAccessArea();

function remoteAccessArea(): SetupArea {
	const tokenStep: SetupStep = {
		id: "cloudflare-token",
		title: "Give splates a Cloudflare API token",
		why: "To reach `splates server` from your phone or another computer, splates makes a Cloudflare tunnel with Cloudflare Access in front, through Cloudflare's API.",
		user: `Create a [Cloudflare API token](${TOKENS_PAGE}) with ${TOKEN_PERMISSIONS.join(", ")}, for your account and your zone, and paste it here. Skip to keep \`splates server\` on this machine only, or to run your own \`TunnelProvider\` from \`splates.config.ts\`.`,
		agent: `Request it with \`splates creds request ${API_TOKEN} --device\`, with how to make it, or let \`splates tunnel setup\` request it.`,
		optional: true,
		after: [],
		fields: [
			{
				kind: "cred",
				name: API_TOKEN,
				label: "Cloudflare API token",
				help: tokenInstructions("your host"),
			},
		],
		check: async ({ device }) => (await device.get(API_TOKEN)) !== undefined,
	};

	const tunnelStep: SetupStep = {
		id: "tunnel",
		title: "Make the tunnel",
		why: "The tunnel carries a host name of yours to `splates server`, and Access lets in only the emails you name.",
		user: "Pick the host name, in a zone of your account, and the emails Access lets in.",
		agent:
			"Run `splates tunnel setup <host> --email <emails>`, adding `--team <name>` when the account has no Zero Trust organization yet.",
		optional: true,
		after: [tokenStep],
		fields: [
			{
				kind: "text",
				name: "host",
				label: "Host name",
				placeholder: "splates.example.com",
			},
			{
				kind: "text",
				name: "email",
				label: "Emails Access lets in, comma separated",
				placeholder: "me@example.com",
			},
			{
				kind: "text",
				name: "team",
				label:
					"Zero Trust team name, only if your account has none yet (for <team>.cloudflareaccess.com)",
				optional: true,
			},
		],
		doing:
			"Making the tunnel, its DNS record and the Access application in Cloudflare…",
		submit: async (machine, answers) => {
			const { fs, home, device } = machine;
			try {
				await tunnelSetup({
					host: String(answers.host),
					email: String(answers.email),
					team: String(answers.team ?? ""),
					name: "splates",
					// The token is kept, as the page checked, so nothing is requested.
					creds: {
						credentials: new Credentials([device]),
						request: async () => null,
						save: async (name, value) => {
							await device.set(name, value.trim());
							return "device";
						},
					},
					task: null,
					saved: new SavedTunnel(`${home}/tunnel.json`, { fs, store: device }),
					log: new MemoryLogger(),
					fetch: machine.fetch,
				});
			} catch (error) {
				throw new Error(plain(error));
			}
		},
		check: async (machine) => (await savedTunnel(machine)) !== null,
	};

	const accessStep: SetupStep = {
		id: "access",
		title: "Check that Access lets only you in",
		why: "Access is the one thing between the internet and agents that run commands on this machine.",
		user: "Open the host on your phone and sign in with an email you named; restart `splates server` first if it ran before the tunnel was made, then press Next.",
		notDone:
			"Access did not send a stranger to its sign-in yet: restart `splates server` if it ran before the tunnel was made, then press Next.",
		agent:
			"Run `splates tunnel status`, then have the user open the host and sign in, and check this step again.",
		optional: true,
		after: [tunnelStep],
		check: async (machine) => {
			const saved = await savedTunnel(machine);
			return saved !== null && guarded(saved, machine.fetch ?? fetch);
		},
	};

	const portsStep: SetupStep = {
		id: "ports-host",
		title: "Open a task's ports from anywhere",
		why: "With a wildcard base host saved, each port a task listens on opens at `https://<task>-<port>.<base>`, behind the same Access, so you can try its server on your phone.",
		user: "Pick a base host in your zone, such as `ports.example.com`. Routing its wildcard `*.ports.example.com` to `splates server`, its DNS and TLS included, is yours to do; a running server picks the base up only on restart.",
		agent:
			"Have the user restart `splates server` with `--ports-host <base>`, which saves the base for this machine, then check this step again.",
		optional: true,
		after: [accessStep],
		fields: [
			{
				kind: "text",
				name: "base",
				label: "Base host",
				placeholder: "ports.example.com",
			},
		],
		submit: async ({ fs, home }, answers) => {
			let base: string | null | undefined;
			try {
				base = portsHostFlag(String(answers.base));
			} catch (error) {
				throw new Error(plain(error));
			}
			if (typeof base !== "string") {
				throw new Error("Give a base host, such as ports.example.com.");
			}
			await new SavedPortsHost(`${home}/ports.json`, fs).save(base);
		},
		check: async ({ fs, home }) =>
			(await new SavedPortsHost(`${home}/ports.json`, fs).read()) !== null,
	};

	return {
		id: "remote-access",
		title: "Remote access",
		steps: [tokenStep, tunnelStep, accessStep, portsStep],
	};
}

/** The tunnel `splates tunnel setup` saved, when its token is kept too. */
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

/** An error as one line for the page, without the command line's flags. */
function plain(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("no Zero Trust organization yet")) {
		return "The account has no Zero Trust organization yet: give a team name below, for <team>.cloudflareaccess.com, to make one.";
	}
	return message;
}
