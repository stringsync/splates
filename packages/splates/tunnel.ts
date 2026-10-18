import { repository } from "@stringsync/splates-server/repository";
import type { SplatesDeps } from "@stringsync/splates-server/runtime-deps";
import { savedTunnelOf } from "@stringsync/splates-server/start-settings";
import { tunnelRemove } from "@stringsync/splates-server/tunnel-remove";
import {
	API_TOKEN,
	tunnelSetup,
} from "@stringsync/splates-server/tunnel-setup";
import { cli } from "webappwiz/cmd";
import { z } from "zod";
import { here, slotTunnelsOf } from "./flags";

/** `splates tunnel`, which the root cli mounts after `splates lane`. */
export const splatesTunnel = cli<SplatesDeps>("tunnel").description(
	"reach `splates server` from elsewhere: a Cloudflare tunnel with Cloudflare Access in front, set up once per machine",
);

splatesTunnel
	.command("setup")
	.use(repository({ needs: "own" }))
	.description(
		`make a Cloudflare tunnel to \`splates server\`, the DNS record routing <host> to it, and an Access application letting in only --email, through the API with the token kept as the cred ${API_TOKEN}, then save them for this machine, so a bare \`splates server\` comes up tunneled; run again, it changes only what is not so already. Without that token it requests it on the Creds page of \`splates server\`, with how to make it, and exits \`requested\`: \`splates creds wait ${API_TOKEN}\`, then run it again`,
	)
	.arg("host", z.string(), {
		description:
			"the public host name, in a zone of the account, as in splates.example.com",
	})
	.option("email", z.string(), {
		default: "",
		description: "comma-separated email addresses Access lets in",
	})
	.option("name", z.string(), {
		default: "splates",
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

splatesTunnel
	.command("status")
	.description(
		"print the tunnel `splates tunnel setup` saved for this machine, which a bare `splates server` runs, and whether its token is in the system's secret store",
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
				"no tunnel saved: `splates tunnel setup <host> --email <you>` makes one",
			);
			return;
		}
		ctx.log.info(
			[
				`host:    https://${record.host}`,
				`team:    ${record.team}.cloudflareaccess.com`,
				`aud:     ${record.aud}`,
				`tunnel:  ${record.tunnel}`,
				`token:   ${token ? "in the device's store" : "missing: run `splates tunnel setup` again"}`,
			].join("\n"),
		);
	});

splatesTunnel
	.command("remove")
	.use(repository({ needs: "own" }))
	.description(
		`delete what \`splates tunnel setup\` and \`splates server --slot\` made in Cloudflare by what they saved: each tunnel, the DNS record routing to it, the Access applications and their policy, then forget the saved files and the tunnels' tokens; the API token kept as ${API_TOKEN} stays. Run again after a failure, it finishes what is left`,
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
