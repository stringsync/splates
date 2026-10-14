import { cli } from "webappwiz/cmd";
import { z } from "zod";
import type { ArborDeps } from "./arbor";
import { here, savedTunnelOf, slotTunnelsOf } from "./arbor-flags";
import { repository } from "./repository";
import { tunnelRemove } from "./tunnel-remove";
import { API_TOKEN, tunnelSetup } from "./tunnel-setup";

/** `arbor tunnel`, which the root cli mounts after `arbor lane`. */
export const arborTunnel = cli<ArborDeps>("tunnel").description(
	"reach `arbor dev` from elsewhere: a Cloudflare tunnel with Cloudflare Access in front, set up once per machine",
);

arborTunnel
	.command("setup")
	.use(repository())
	.description(
		`make a Cloudflare tunnel to \`arbor dev\`, the DNS record routing <host> to it, and an Access application letting in only --email, through the API with the token kept as the cred ${API_TOKEN}, then save them for this machine, so a bare \`arbor dev\` comes up tunneled; run again, it changes only what is not so already. Without that token it requests it on the Creds page of \`arbor dev\`, with how to make it, and exits \`requested\`: \`arbor creds wait ${API_TOKEN}\`, then run it again`,
	)
	.arg("host", z.string(), {
		description:
			"the public host name, in a zone of the account, as in arbor.example.com",
	})
	.option("email", z.string(), {
		default: "",
		description: "comma-separated email addresses Access lets in",
	})
	.option("name", z.string(), {
		default: "arbor",
		description:
			"what the tunnel, the Access application and its policy are called",
	})
	.option("team", z.string(), {
		default: "",
		description:
			"the Zero Trust team to make, as in <team>.cloudflareaccess.com, when the account has none yet",
	})
	.action(async (opts, ctx) =>
		ctx.journal.record("tunnel setup", null, async () =>
			tunnelSetup({
				...opts,
				creds: ctx.creds,
				task: await here(ctx),
				saved: savedTunnelOf(ctx),
				log: ctx.log,
				fetch: ctx.fetch,
			}),
		),
	);

arborTunnel
	.command("status")
	.description(
		"print the tunnel `arbor tunnel setup` saved for this machine, which a bare `arbor dev` runs, and whether its token is in the system's secret store",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) => {
		const saved = savedTunnelOf(ctx);
		const record = await saved.read();
		const token = record === null ? false : (await saved.token()) !== undefined;
		if (opts.json) {
			ctx.log.info(
				JSON.stringify(record === null ? null : { ...record, token }),
			);
			return;
		}
		if (record === null) {
			ctx.log.info(
				"no tunnel saved: `arbor tunnel setup <host> --email <you>` makes one",
			);
			return;
		}
		ctx.log.info(
			[
				`host:    https://${record.host}`,
				`team:    ${record.team}.cloudflareaccess.com`,
				`aud:     ${record.aud}`,
				`tunnel:  ${record.tunnel}`,
				`token:   ${token ? "in the device's store" : "missing: run `arbor tunnel setup` again"}`,
			].join("\n"),
		);
	});

arborTunnel
	.command("remove")
	.use(repository())
	.description(
		`delete what \`arbor tunnel setup\` and \`arbor dev --slot\` made in Cloudflare by what they saved: each tunnel, the DNS record routing to it, the Access applications and their policy, then forget the saved files and the tunnels' tokens; the API token kept as ${API_TOKEN} stays. Run again after a failure, it finishes what is left`,
	)
	.action(async (_opts, ctx) =>
		ctx.journal.record("tunnel remove", null, async () =>
			tunnelRemove({
				saved: savedTunnelOf(ctx),
				slots: slotTunnelsOf(ctx),
				creds: ctx.creds,
				task: await here(ctx),
				fs: ctx.fs,
				log: ctx.log,
				fetch: ctx.fetch,
			}),
		),
	);
