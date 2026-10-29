import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { DEFAULT_PORT } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates ship [project]` prints the Ships page link for the person to open. */
export const splatesShip = cli<SplatesDeps>("ship")
	.description("open the ship plan page")
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
		page.hash = "ships/plan";
		if (opts.project !== "") {
			page.searchParams.set("ship", opts.project);
		}
		ctx.log.info(`Open ship plan: ${page}`);
		const local = new URL(page);
		local.hostname = "localhost";
		local.protocol = "http:";
		local.port =
			page.hostname === "localhost" || page.hostname === "127.0.0.1"
				? page.port
				: String(DEFAULT_PORT);
		ctx.log.info(`Local: ${local}`);
	});
