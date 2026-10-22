import { repository } from "@stringsync/splates-server/records";
import { Replicator, statusLines } from "@stringsync/splates-server/replica";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates replica`, which the root cli mounts after `splates config`. */
export const splatesReplica = cli<SplatesDeps>("replica").description(
	"the copy of this project's records `splates server` keeps a few seconds behind every change, in the bucket or folder `replica` names in splates.config.ts",
);

splatesReplica
	.command("status")
	.use(repository({ needs: "read" }))
	.description(
		"print where the replica is, when it last held every change, how many changes wait to reach it and since when, and why it is failing if it is; as of the server's last batch, so it reads the same with the server stopped",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) => {
		const status = await Replicator.recorded(ctx.storage);
		if (opts.json) {
			ctx.log.info(JSON.stringify(status));
			return;
		}
		ctx.log.info(
			statusLines(status, ctx.config.replica !== null, Date.now()).join("\n"),
		);
	});
