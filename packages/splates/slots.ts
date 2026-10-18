import type { SplatesDeps } from "@stringsync/splates-server/runtime-deps";
import { type Held, Slots } from "@stringsync/splates-server/slots";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates slots`, which the root cli mounts after `splates tunnel`. */
export const splatesSlots = cli<SplatesDeps>("slots").description(
	"the words `splates server --slot` hands out on this machine, each held by the tree that claimed it: a task's worktree holds its word until the task merges or is removed, which stops its server and gives the word back",
);

splatesSlots
	.command("list")
	.description(
		"print each claimed word, the tree holding it, its server's pid while one runs, and whether it is orphaned: its tree gone, or a splates repository's main tree, which every agent shares",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) => {
		const held = await Slots.ofMachine(ctx).status();
		if (opts.json) {
			ctx.log.info(
				JSON.stringify(
					held.map(({ slot, tree, pid, orphaned }) => ({
						word: slot.word,
						tree,
						pid,
						orphaned,
					})),
				),
			);
			return;
		}
		if (held.length === 0) {
			ctx.log.info("no slot is claimed");
			return;
		}
		ctx.log.info(held.map(heldLine).join("\n"));
	});

splatesSlots
	.command("prune")
	.description(
		"free every orphaned word, stopping its server, so another tree can claim it; the slots a task's worktree holds are that task's, and left alone. The way to free a slot: never kill another tree's server or edit ~/.splates/slots.json",
	)
	.action(async (_opts, ctx) => {
		const freed = await Slots.ofMachine(ctx).prune();
		if (freed.length === 0) {
			ctx.log.info(
				"nothing to prune: each claimed word is held by a task's worktree",
			);
			return;
		}
		ctx.log.info(
			freed
				.map(
					({ slot, tree, pid }) =>
						`freed ${slot.word} ${slot.emoji} from ${tree}${pid === null ? "" : `, its server (pid ${pid}) stopped`}`,
				)
				.join("\n"),
		);
	});

function heldLine({ slot, tree, pid, orphaned }: Held): string {
	const server = pid === null ? "no server" : `server pid ${pid}`;
	return `${slot.word} ${slot.emoji}  ${tree}  ${server}${orphaned ? "  orphaned: `splates slots prune` frees it" : ""}`;
}
