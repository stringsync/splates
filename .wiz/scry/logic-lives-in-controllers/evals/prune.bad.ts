import { cli } from "webappwiz/cmd";
import { z } from "zod";

export const app = cli("app");

app
	.command("prune")
	.option("days", z.coerce.number(), { default: 30 })
	.action(async (opts, { fs, log }) => {
		const cutoff = Date.now() - opts.days * 86_400_000;
		let removed = 0;
		for (const name of await fs.readdir("logs")) {
			const { mtime } = await fs.stat(`logs/${name}`);
			if (mtime.getTime() < cutoff) {
				await fs.rm(`logs/${name}`);
				removed++;
			}
		}
		log.info(removed === 0 ? "nothing to prune" : `pruned ${removed} logs`);
	});
