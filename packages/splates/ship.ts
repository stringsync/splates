import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { DEFAULT_PORT } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates ship [project]` prints the Ships page link for the person to open. */
export const splatesShip = cli<SplatesDeps>("ship")
	.description("open the Ships page; ship-step planning is coming")
	.fallback("run");

splatesShip
	.command("run")
	.use(repository({ needs: "read" }))
	.arg("project", z.string(), {
		default: "",
		description: "the registered project to show",
	})
	.option("dev", z.string(), {
		default: "",
		description: "the splates server URL",
	})
	.action((opts, ctx) => {
		const page = new URL(
			"/",
			opts.dev ||
				ctx.ps.env("SPLATES_DEV") ||
				`http://localhost:${DEFAULT_PORT}`,
		);
		page.hash = "ships";
		if (opts.project !== "") {
			page.searchParams.set("ship", opts.project);
		}
		ctx.log.info(`Open Ships: ${page}`);
	});
