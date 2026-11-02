import { Credentials } from "core/creds";
import { MemoryLogger } from "core/log";
import { z } from "zod";
import { FsStorage } from "../storage";
import {
	API_TOKEN,
	CloudflareApi,
	portsHostFlag,
	SavedPortsHost,
	SavedTunnel,
	TOKEN_PERMISSIONS,
	TOKENS_PAGE,
	type TunnelRecord,
	tokenInstructions,
	tunnelSetup,
} from "../tunnel";
import type { SetupArea, SetupMachine, SetupStep } from "./setup";

/** Cloudflare's page of `cloudflared` downloads, which covers every platform. */
const CLOUDFLARED_DOWNLOADS =
	"https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";

/** How long an install gets before it counts as failed. */
const INSTALL_MS = 10 * 60_000;

/** Reaching `splates server` from a phone or another computer, behind Access. */
export const REMOTE_ACCESS_AREA: SetupArea = remoteAccessArea();

function remoteAccessArea(): SetupArea {
	const cloudflaredStep: SetupStep = {
		id: "cloudflared",
		title: "Install cloudflared",
		why: "A tunnel lets your phone or another computer reach `splates server` on this machine without opening a port on your router or exposing your IP address: `cloudflared` dials out to Cloudflare, which carries your own host name back to it, behind Cloudflare Access so only the emails you name get in. `cloudflared` is the program that holds that connection open.",
		user: `Next installs it with Homebrew (\`brew install cloudflared\`); without Homebrew, install it from [Cloudflare's downloads](${CLOUDFLARED_DOWNLOADS}) and press Next. You also need a domain whose DNS is on Cloudflare, which a later step checks.`,
		agent: `Check \`cloudflared --version\`; press Next on the page to install it with Homebrew on a Mac, or send the user to ${CLOUDFLARED_DOWNLOADS}. Explain why they would want a tunnel before asking for anything else.`,
		optional: true,
		after: [],
		doing: "Installing cloudflared with Homebrew…",
		check: async (machine) =>
			cloudflaredVersion(machine).then((version) => version !== null),
		found: async (machine) => {
			const version = await cloudflaredVersion(machine);
			return version === null ? null : `${version} is installed.`;
		},
		submit: async ({ ps }) => {
			const result = await ps
				?.spawnCapture(["brew", "install", "cloudflared"], {
					timeoutMs: INSTALL_MS,
					stdin: "",
				})
				.catch(() => null);
			if (result?.exitCode !== 0) {
				throw new Error(
					`Could not install cloudflared from here. Install it from ${CLOUDFLARED_DOWNLOADS}, then press Next.`,
				);
			}
		},
		// Other tools may use it, so only the person takes it out.
		undo: {
			removes: async () => [],
			leaves: async () => [
				"cloudflared stays installed: run `brew uninstall cloudflared` to remove it.",
			],
			run: async () => {},
		},
	};

	const tokenStep: SetupStep = {
		id: "cloudflare-token",
		title: "Give splates a Cloudflare API token",
		why: "To reach `splates server` from your phone or another computer, splates makes a Cloudflare tunnel with Cloudflare Access in front, through Cloudflare's API.",
		user: `Create a [Cloudflare API token](${TOKENS_PAGE}) with these permissions (${TOKEN_PERMISSIONS.join("; ")}), for your account and your zone, and paste it here. Skip to keep \`splates server\` on this machine only, or to use a tunnel of your own, which \`splates.config.ts\` can name instead.`,
		agent: `Request it with \`splates creds request ${API_TOKEN} --device\`, with how to make it, or let \`splates tunnel setup\` request it.`,
		optional: true,
		after: [cloudflaredStep],
		fields: [
			{
				kind: "cred",
				name: API_TOKEN,
				label: "Cloudflare API token",
				help: tokenInstructions("your host"),
			},
		],
		check: async ({ device }) => (await device.get(API_TOKEN)) !== undefined,
		// The token goes with the area; Cloudflare keeps it until it is deleted there.
		undo: {
			removes: async () => [],
			leaves: async () => [
				`The API token itself: delete it in [Cloudflare's API tokens](${TOKENS_PAGE}).`,
				"The account's Zero Trust organization, which `splates tunnel setup` may have made, stays: it costs nothing on its own.",
			],
			run: async () => {},
		},
	};

	const domainStep: SetupStep = {
		id: "cloudflare-domain",
		title: "Check your domain is on Cloudflare",
		why: "The tunnel's host name has to live in a domain whose DNS Cloudflare serves, since splates adds the DNS record that routes the host to the tunnel.",
		user: "Add a domain to your Cloudflare account if you have none ([Add a site](https://dash.cloudflare.com/?to=/:account/add-site)), pointing its nameservers at Cloudflare, then press Next. Any subdomain of it works as the host name.",
		notDone:
			"The token sees no domain on your Cloudflare account yet: add one, give the token Zone Read and DNS Edit on it, then press Next.",
		agent:
			"Press Next on the page, which lists the zones the token can read. If there are none, help the user add a domain to Cloudflare and check the token's zone permission.",
		optional: true,
		after: [tokenStep],
		uses: [API_TOKEN],
		doing: "Asking Cloudflare for your domains…",
		check: async (machine) => (await zones(machine)).length > 0,
		found: async (machine) => {
			const names = await zones(machine);
			return names.length === 0
				? null
				: `Your account serves ${names.map((name) => `\`${name}\``).join(", ")}.`;
		},
	};

	const tunnelStep: SetupStep = {
		id: "tunnel",
		title: "Make the tunnel",
		why: "The tunnel carries a host name of yours to `splates server`, and Access lets in only the emails you name.",
		user: "Pick the host name, in a zone of your account, and the emails Access lets in.",
		agent:
			"Run `splates tunnel setup <host> --email <emails>`, adding `--team <name>` when the account has no Zero Trust organization yet.",
		optional: true,
		after: [domainStep],
		// Removed with the API token, which workers' Access step asks for too.
		uses: [API_TOKEN],
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
				label: "Cloudflare team name (only for a new account)",
				help: "Cloudflare Access needs a team name, which becomes `<team>.cloudflareaccess.com`. Leave this empty if your account has one already; fill it in to make one.",
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
					saved: SavedTunnel.in(new FsStorage(`${home}`, fs), device),
					log: new MemoryLogger(),
					fetch: machine.fetch,
				});
			} catch (error) {
				throw new Error(plain(error));
			}
		},
		check: async (machine) => (await savedTunnel(machine)) !== null,
		undo: {
			removes: async (machine) => {
				const host = (await savedTunnel(machine))?.host ?? "the host";
				return [
					`The tunnel to ${host}, and the DNS record routing ${host} to it`,
					`The Access application in front of ${host}, and its policy`,
					"The workers' Access policy and its service tokens: workers joined through the tunnel lose their access",
					"Each slot's tunnel, and the Access application in front of every slot",
				];
			},
			refused: async ({ removeTunnel }) =>
				removeTunnel === undefined
					? "Open Setup from a project to remove the tunnel: its API token is read through the project's creds."
					: null,
			// Its host is public, and another tunnel would need setting up again.
			confirm: async (machine) => (await savedTunnel(machine))?.host ?? null,
			run: async ({ removeTunnel }) => {
				if (removeTunnel === undefined) {
					throw new Error("No project to remove the tunnel from.");
				}
				await removeTunnel();
			},
		},
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
		extra: true,
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
			await SavedPortsHost.in(new FsStorage(`${home}`, fs)).save(base);
		},
		check: async ({ fs, home }) =>
			(await SavedPortsHost.in(new FsStorage(`${home}`, fs)).read()) !== null,
		undo: {
			removes: async ({ fs, home }) => {
				const base = await SavedPortsHost.in(
					new FsStorage(`${home}`, fs),
				).read();
				return [
					`The saved base host ${base}, which a running \`splates server\` serves until it restarts`,
				];
			},
			leaves: async ({ fs, home }) => {
				const base = await SavedPortsHost.in(
					new FsStorage(`${home}`, fs),
				).read();
				return [
					`The DNS and TLS routing \`*.${base}\` to \`splates server\`, which you made: remove it where you made it.`,
				];
			},
			run: async ({ fs, home }) => {
				await SavedPortsHost.in(new FsStorage(`${home}`, fs)).save(null);
			},
		},
	};

	return {
		id: "remote-access",
		title: "Remote access",
		purpose: "Reach splates server from your phone or another computer.",
		steps: [
			cloudflaredStep,
			tokenStep,
			domainStep,
			tunnelStep,
			accessStep,
			portsStep,
		],
	};
}

/** What `cloudflared --version` prints, or null when it is not there. */
async function cloudflaredVersion({
	ps,
}: SetupMachine): Promise<string | null> {
	const result = await ps
		?.spawnCapture(["cloudflared", "--version"], { timeoutMs: 10_000 })
		.catch(() => null);
	return result?.exitCode === 0 ? result.stdout.trim() : null;
}

/** The names of the domains the API token can read; none without the token. */
async function zones({ device, fetch }: SetupMachine): Promise<string[]> {
	const token = await device.get(API_TOKEN);
	if (token === undefined) {
		return [];
	}
	const found = await new CloudflareApi(token, { fetch }).list(
		"/zones",
		z.object({ name: z.string() }),
	);
	return found.map((zone) => zone.name);
}

/** The tunnel `splates tunnel setup` saved, when its token is kept too. */
async function savedTunnel({
	fs,
	home,
	device,
}: SetupMachine): Promise<TunnelRecord | null> {
	const saved = SavedTunnel.in(new FsStorage(`${home}`, fs), device);
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
