import { cli } from "webappwiz/cmd";
import { color } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import type { ArborDeps } from "./arbor";
import { here } from "./arbor-flags";
import { DEFAULT_TIMEOUT } from "./creds";
import { fail } from "./exit";
import { repository } from "./repository";
import { untilAfter } from "./wait";

/** `arbor creds`, which the root cli mounts after `arbor lane`. */
export const arborCreds = cli<ArborDeps>("creds").description(
	"creds an agent needs a person for, such as an API token: request one saying what it is for, with instructions for getting it, which the Creds page of `arbor dev` shows for the person to paste, then wait for it; the value goes into the system's store (the macOS Keychain, Windows Credential Manager, a Linux secret service), never to the agent, and code reads it through webappwiz/creds",
);

arborCreds
	.command("request")
	.use(repository({ needs: "own" }))
	.description(
		"ask a person for a cred, saying why it is needed and what it will be used for, with markdown instructions for getting it; returns at once, and does nothing when the store already keeps it unless --replace; run from a worktree, it records the task asking",
	)
	.arg("name", z.string(), {
		description: "what it is kept as, an environment variable's name",
	})
	.option("purpose", z.string(), {
		default: "",
		description:
			"why it is needed and what it will be used for, in a sentence the person reads before getting it",
	})
	.option("instructions", z.string(), {
		default: "",
		description:
			"how to get it, in markdown: where to go, what to pick, what to paste",
	})
	.option("device", z.boolean(), {
		default: false,
		description:
			"keep it for every project on this device, as for a person's own account, rather than this project alone",
	})
	.option("replace", z.boolean(), {
		default: false,
		description:
			"ask again although one is kept, since the kept one does not work; --purpose and --instructions left off are those of the last request",
	})
	.action(async (opts, ctx) => {
		const scope = opts.device ? "device" : "project";
		const request = await ctx.journal.record(
			"creds request",
			null,
			async () =>
				ctx.creds.request(opts.name, {
					scope,
					purpose: opts.purpose,
					instructions: opts.instructions,
					task: await here(ctx),
					replace: opts.replace,
				}),
			(asked) => ({ name: opts.name, asked: asked !== null }),
		);
		if (request === null) {
			ctx.log.info(
				`${color.green("kept")} ${opts.name} in ${ctx.creds.label(scope)}: nothing to ask`,
			);
			return;
		}
		ctx.log.info(
			`${color.yellow("requested")} ${opts.name}  ${color.dim(request.purpose)}`,
		);
		ctx.log.error(
			`It shows on the Creds page of \`arbor dev\`. \`arbor creds wait ${opts.name}\` until it is saved.`,
		);
	});

arborCreds
	.command("wait")
	.use(repository({ needs: "own" }))
	.description(
		"block until a person saves the cred requested, or dismisses the request (`dismissed`); gives up with `timeout` rather than waiting forever",
	)
	.arg("name", z.string(), { description: "the cred requested" })
	.option("timeout-secs", z.coerce.number(), {
		default: DEFAULT_TIMEOUT.secs,
		description: "how long to wait before giving up",
	})
	.action(async (opts, ctx) => {
		const timeout = Duration.secs(opts["timeout-secs"]);
		await ctx.journal.waiting(
			"creds wait",
			null,
			{ name: opts.name, until: untilAfter(timeout) },
			async () => {
				const ended = await ctx.creds.wait(opts.name, { timeout });
				if (ended === "dismissed") {
					fail(
						"dismissed",
						`${opts.name} was dismissed: carry on without it, or ask the person why`,
						{ name: opts.name },
					);
				}
			},
		);
		ctx.log.info(`${color.green("saved")} ${opts.name}`);
	});

arborCreds
	.command("list")
	.use(repository({ needs: "read" }))
	.description(
		"the creds requested and still open, with what each is for, and every cred the project's store and the device's keep, by name; never a value",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) => {
		const open = (await ctx.creds.requests()).filter(
			(each) => each.status === "open",
		);
		const kept = await ctx.creds.kept();
		if (opts.json) {
			ctx.log.info(JSON.stringify({ requested: open, kept }, null, 2));
			return;
		}
		for (const each of open) {
			ctx.log.info(
				`${color.yellow("requested")} ${each.name}  ${color.dim(each.scope)}${each.task === null ? "" : color.dim(`  by ${each.task}`)}`,
			);
			if (each.purpose !== "") {
				ctx.log.info(`          ${each.purpose}`);
			}
		}
		for (const each of kept) {
			ctx.log.info(
				`${color.green("kept")}      ${each.name}  ${color.dim(each.scope)}${each.savedBy === null ? "" : color.dim(`  saved by ${each.savedBy}`)}`,
			);
		}
		if (open.length === 0 && kept.length === 0) {
			ctx.log.info(color.dim("no creds requested or kept"));
		}
	});
