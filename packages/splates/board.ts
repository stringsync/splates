import {
	boardAdd,
	boardList,
	boardRemove,
	boardRenamed,
	boardShow,
	boardUpdate,
} from "@splates/server/board";
import { repository } from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import { cli } from "core/cmd";
import { z } from "zod";
import { position } from "./flags";

const boardNumber = z.coerce.number().int().positive();

/** `splates board`, which the root cli mounts after `splates lane`. */
export const splatesBoard = cli<SplatesDeps>("board").description(
	"boards: named groups of lanes, organizational only; a lane is on exactly one board, and tasks, links and the queue do not change with it. The Default board (1) is permanent and holds Backlog. Queueing stays the person's, per lane",
);

splatesBoard
	.command("list")
	.use(repository({ needs: "read" }))
	.description("every board in order, with the lanes on it")
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => boardList(ctx, { json: opts.json }));

splatesBoard
	.command("show")
	.use(repository({ needs: "read" }))
	.description("one board and its lanes in order")
	.arg("board", boardNumber, { description: "board number" })
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => boardShow(ctx, opts.board, { json: opts.json }));

splatesBoard
	.command("add")
	.use(repository({ needs: "tasks" }))
	.description("start an empty board, after the others")
	.arg("name", z.string(), {
		description: "what its lanes are for, like `Launch`",
	})
	.action(async (opts, ctx) => {
		await ctx.journal.record(
			"board add",
			null,
			() => boardAdd(ctx, opts.name),
			(board) => ({ board: board.id, name: board.name }),
		);
	});

splatesBoard
	.command("update")
	.use(repository({ needs: "tasks" }))
	.description(
		"rename a board, move it among the others, or put it away (`--archived`) or bring it back (`--no-archived`); archiving keeps its lanes, tasks and links. The default board cannot be archived",
	)
	.arg("board", boardNumber, { description: "board number" })
	.option("name", z.string().optional(), {
		description: "what it is called from now on",
	})
	.option("position", position, {
		description: "where to move it among the boards, 1 the first",
	})
	.option("archived", z.boolean().optional(), {
		description: "put it away, or with --no-archived bring it back",
	})
	.action(async (opts, ctx) => {
		const change = {
			name: opts.name,
			position: opts.position,
			archived: opts.archived,
		};
		if (opts.name === undefined) {
			await boardUpdate(ctx, opts.board, change);
			return;
		}
		await ctx.journal.record(
			"board rename",
			null,
			() => boardUpdate(ctx, opts.board, change),
			boardRenamed,
		);
	});

splatesBoard
	.command("remove")
	.use(repository({ needs: "tasks" }))
	.description(
		"delete a board and its empty lanes; agents may delete a board whose lanes hold no tasks; for one whose lanes hold tasks, move the lanes elsewhere first or ask with a permission card. The default board cannot be deleted",
	)
	.arg("board", boardNumber, { description: "board number" })
	.action((opts, ctx) => {
		const byAgent =
			ctx.service.ps.env("SPLATES_CONVERSATION") !== undefined ||
			ctx.service.ps.env("SPLATES_STARTED_BY") !== undefined;
		return boardRemove(ctx, opts.board, { force: !byAgent });
	});
