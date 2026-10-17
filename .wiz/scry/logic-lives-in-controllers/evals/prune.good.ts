import { cli } from "webappwiz/cmd";
import { z } from "zod";
import { Prune } from "./prune";

export const app = cli("app");

app
	.command("prune")
	.option("days", z.coerce.number(), { default: 30 })
	.action((opts, deps) => new Prune(deps).run(opts));
