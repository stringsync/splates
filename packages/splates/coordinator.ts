import {
	type BoxStanding,
	CoordinatorBox,
} from "@stringsync/splates-server/coordinator";
import { RUNNING, type SplatesDeps } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates coordinator`, which the root cli mounts after `splates budget`. */
export const splatesCoordinator = cli<SplatesDeps>("coordinator").description(
	"the always-on box in your own Hetzner Cloud account that `splates server` moves onto, made through Pulumi with the token and state the Cloud workers setup readied: a CPX21 in Ashburn with Hetzner's daily backups, reached by SSH alone",
);

splatesCoordinator
	.command("up")
	.description(
		"make the coordinator's box, or bring it to its program, with splates of this release installed for the user splates and an SSH key splates makes under ~/.splates/coordinator; run again, it changes only what is not so already. The box serves nothing until the coordinator moves onto it",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) => {
		ctx.log.info("making the coordinator's box; its first boot takes minutes");
		print(ctx, await box(ctx).up(), opts.json);
	});

splatesCoordinator
	.command("status")
	.description("print the coordinator's box as its Pulumi stack has it")
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) => {
		const standing = await box(ctx).status();
		if (standing === null) {
			ctx.log.info(
				opts.json
					? "null"
					: "no coordinator's box: `splates coordinator up` makes one",
			);
			return;
		}
		print(ctx, standing, opts.json);
	});

splatesCoordinator
	.command("remove")
	.description(
		"destroy the coordinator's box and its backups, lifting the protection that keeps it from deletion first, and forget its stack; its SSH key stays. Anything only on the box is lost",
	)
	.action(async (_opts, ctx) => {
		await box(ctx).remove();
		ctx.log.info("removed the coordinator's box");
	});

function box(ctx: SplatesDeps): CoordinatorBox {
	return new CoordinatorBox({ version: RUNNING, ps: ctx.ps, fs: ctx.fs });
}

function print(ctx: SplatesDeps, standing: BoxStanding, json: boolean): void {
	if (json) {
		ctx.log.info(JSON.stringify(standing));
		return;
	}
	ctx.log.info(
		[
			`address:  ${standing.ipv4}`,
			`server:   ${standing.serverId} (${standing.serverType} in ${standing.location})`,
			`ssh:      ssh -i ${standing.key} root@${standing.ipv4}`,
		].join("\n"),
	);
}
