import { SavedPortsHost } from "./saved-ports-host";
import { SavedTunnel, type TunnelRecord } from "./saved-tunnel";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";
import { SLOT_POOL } from "./slots";
import { API_TOKEN, TOKEN_PERMISSIONS, TOKENS_PAGE } from "./tunnel-setup";

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
		fields: [{ kind: "cred", name: API_TOKEN, label: "Cloudflare API token" }],
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
		check: async (machine) => (await savedTunnel(machine)) !== null,
	};

	const accessStep: SetupStep = {
		id: "access",
		title: "Check that Access lets only you in",
		why: "Access is the one thing between the internet and agents that run commands on this machine.",
		user: "Open the host on your phone and sign in with an email you named; restart `splates server` first if it ran before the tunnel was made.",
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
		user: "Pick a base host in your zone, such as `ports.example.com`, and route its wildcard `*.ports.example.com` to `splates server`, its DNS and TLS included.",
		agent:
			"Have the user restart `splates server` with `--ports-host <base>`, which saves the base for this machine, then check this step again.",
		optional: true,
		after: [accessStep],
		check: async ({ fs, home }) =>
			(await new SavedPortsHost(`${home}/ports.json`, fs).read()) !== null,
	};

	const slotsStep: SetupStep = {
		id: "slot-tunnels",
		title: "Serve a task's checkout at a host of its own",
		why: "`splates server --slot` serves a task's worktree at `<word>.<zone>`, behind the same Access, so you can try a change on your phone before it lands.",
		user: "Nothing but to say yes: an agent runs it when it has a change to show you.",
		agent:
			"Run `splates server --slot` from a task's worktree, which makes the slot's tunnel the first time.",
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

	return {
		id: "remote-access",
		title: "Remote access",
		steps: [tokenStep, tunnelStep, accessStep, portsStep, slotsStep],
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
