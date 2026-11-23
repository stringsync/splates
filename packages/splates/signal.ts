import { conversationOf } from "@splates/server/conversations";
import { EXIT, fail, type Reason } from "@splates/server/exit";
import { repository } from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import { SERVER_WAIT_MS } from "@splates/server/tasks";
import { serverOf } from "@splates/server/workers";
import { cli } from "core/cmd";
import { color } from "core/log";
import { z } from "zod";
import { here } from "./flags";

/** `splates signal`, which the root cli mounts after `splates creds`. */
export const splatesSignal = cli<SplatesDeps>("signal").description(
	"announce a fact to the agents waiting on it, or wait for one: `raise` a named signal with a JSON payload and every conversation waiting on it wakes, `wait` ends your turn and the conversation wakes when it is raised or the timeout passes. A raise reaches only the waits there at that moment, and nothing is stored as current truth; `--since` on a wait also takes a raise kept from before it",
);

/** Posts `body` to the splates server at `path`, or fails with what it refused. */
async function post(
	ctx: SplatesDeps,
	path: string,
	body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const server = await serverOf(ctx as Parameters<typeof serverOf>[0]);
	if (server === null) {
		fail(
			"usage",
			"signals need `splates server` running: there is none to carry them",
		);
	}
	const response = await server.send(`${server.url}${path}`, {
		method: "POST",
		headers: { origin: server.url, "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(SERVER_WAIT_MS),
	});
	const answer = (await response.json().catch(() => ({}))) as Record<
		string,
		unknown
	> & { reason?: string; message?: string };
	if (!response.ok) {
		const reason = answer.reason as Reason;
		fail(
			reason in EXIT ? reason : "usage",
			answer.message ?? `splates server refused it: ${response.status}`,
		);
	}
	return answer;
}

for (const name of ["fire", "raise"] as const) {
	splatesSignal
		.command(name)
		.use(repository({ needs: "own" }))
		.description(
			"fire a signal, as `mdom.released`, with an optional JSON payload: every conversation waiting on it at this moment wakes with it. Agents and splates-managed rigs can fire signals. Firing it again later is a new firing",
		)
		.arg("name", z.string(), {
			description:
				'the signal: a name as mdom.released, or a call with arguments (JSON5, may span lines) as clock.in("2 days") or aws.stack-ready({ stack: "x" }); a plain value maps to the signal function\'s main field',
		})
		.option("data", z.string(), {
			default: "",
			description: "the payload, as JSON",
		})
		.option("conversation", z.string(), {
			default: "",
			description:
				"conversation id, when not run by an agent `splates server` started",
		})
		.action(async (opts, ctx) => {
			let payload: unknown;
			if (opts.data !== "") {
				try {
					payload = JSON.parse(opts.data);
				} catch {
					fail("usage", `--data is no JSON: '${opts.data}'`, {});
				}
			}
			if (name === "raise") {
				ctx.log.error(
					"`splates signal raise` is deprecated: use `splates signal fire`",
				);
			}
			const rig =
				opts.conversation === "" ? ctx.ps.env("SPLATES_RIG") : undefined;
			const by = rig
				? `rig:${rig}`
				: ((await here(ctx)) ??
					(await conversationOf(ctx.service, opts.conversation)));
			const answer = await post(ctx, "/api/signals/raise", {
				name: opts.name,
				by,
				payload,
			});
			ctx.log.info(
				`${color.green("fired")} ${opts.name}: ${String(answer.delivered)} waiting conversation${answer.delivered === 1 ? "" : "s"} woken`,
			);
		});
}

splatesSignal
	.command("wait")
	.use(repository({ needs: "own" }))
	.description(
		"wait for a signal by ending your turn: the conversation shows one card and wakes with `[SPLATES SIGNAL <name>]` and the payload when it is fired, or with `timeout` once --timeout passes, or `stopped` when the person stops it. Only a firing after the wait begins counts, unless --since takes one from before. End your turn right after it. The conversation is $SPLATES_CONVERSATION, or --conversation <id> from an agent outside `splates server`",
	)
	.arg("name", z.string(), {
		description:
			'the signal: a name as mdom.released, or a call with arguments (JSON5, may span lines) as clock.in("2 days") or aws.stack-ready({ stack: "x" }); a plain value maps to the signal function\'s main field',
	})
	.option("timeout", z.string(), {
		default: "",
		description: "how long to wait, as 30m, 2h or 1d (7d at most); required",
	})
	.option("description", z.string(), {
		default: "",
		description:
			"one or two plain sentences a stranger understands: the fact that holds when it fires and why it is awaited; the card shows it in every state; required, at least 5 words",
	})
	.option("since", z.string(), {
		default: "",
		description:
			"also accept a raise from after this: how long ago (30m, 2h, 1d, up to 7d) or an ISO time",
	})
	.option("conversation", z.string(), {
		default: "",
		description:
			"conversation id, when not run by an agent `splates server` started",
	})
	.action(async (opts, ctx) => {
		const tooShort = checkDescription(opts.description);
		if (tooShort !== undefined) {
			throw new Error(tooShort);
		}
		const id = await conversationOf(ctx.service, opts.conversation);
		const wait = await post(ctx, `/api/conversations/${id}/signal-wait`, {
			name: opts.name,
			description: opts.description,
			timeout: opts.timeout,
			...(opts.since === "" ? {} : { since: opts.since }),
		});
		ctx.log.info(
			wait.state === "raised"
				? `${color.green("raised")} ${opts.name} already, since ${opts.since}: the conversation wakes now; end your turn`
				: `${color.green("waiting")} for ${opts.name} until ${String(wait.deadline)}: end your turn now, and the conversation wakes when it is raised or the timeout passes`,
		);
	});

const MIN_DESCRIPTION_WORDS = 5;

/** Refuses a signal description too terse for a stranger to read, saying what a good one holds. */
export const checkDescription = (description: string): string | undefined =>
	description.trim().split(/\s+/).filter(Boolean).length >=
	MIN_DESCRIPTION_WORDS
		? undefined
		: `--description needs at least ${String(MIN_DESCRIPTION_WORDS)} words: one or two plain sentences naming the fact that holds when the signal fires and why it is awaited, as "The mdom 2.4.0 release is on npm, so vexml can adopt it."`;

/** Turns the arguments after `--` into the probe's script: pass the script as one argument to run it as written, or a command as several. */
export const pollScript = (args: readonly string[]): string =>
	args.length === 1
		? (args[0] as string)
		: // Each is shell-quoted, so its spaces and pipes survive `sh -c`.
			args
				.map((arg) =>
					/^[\w@%+=:,./-]+$/.test(arg)
						? arg
						: `'${arg.replaceAll("'", "'\\''")}'`,
				)
				.join(" ");

for (const name of ["poll", "probe"] as const) {
	splatesSignal
		.command(name)
		.use(repository({ needs: "own" }))
		.description(
			"attach a poll script to a signal: a shell script, given after --, that the server runs in this project's main tree while something waits on the signal: at once when a wait begins, then every --interval (30s at the most often), skipping runs while the machine is busy. A run that exits 0 after a failing one, or a wait's first run that exits 0, raises the signal with the script's stdout (JSON if it parses) and checkedAt. It stops once raised with nothing left waiting, when its last wait ends, at --timeout (waking its waits with `timeout`), or when the person stops it. Polling a signal again replaces its poll script, and its waits stay. Needs no approval; the conversation shows its card. Then `splates signal wait` on it",
		)
		.arg("name", z.string(), {
			description:
				'the signal: a name as mdom.released, or a call with arguments (JSON5, may span lines) as clock.in("2 days") or aws.stack-ready({ stack: "x" }); a plain value maps to the signal function\'s main field',
		})
		.option("interval", z.string(), {
			default: "",
			description: "how often to run it, as 30s, 5m or 1h; required",
		})
		.option("every", z.string(), {
			default: "",
			description: "deprecated: use --interval",
		})
		.option("timeout", z.string(), {
			default: "",
			description: "when it stops, as 30m, 6h or 1d (7d at most); required",
		})
		.option("description", z.string(), {
			default: "",
			description:
				"one or two plain sentences a stranger understands: the fact that holds when the check passes and why it is awaited; its card shows it; required, at least 5 words",
		})
		.option("conversation", z.string(), {
			default: "",
			description:
				"conversation id, when not run by an agent `splates server` started",
		})
		.rest("script", z.string(), {
			description:
				"the script, after --, run with `sh -c`; exit 0 means the condition holds, exit 1 not yet, and any other exit shows the check as broken on its card. Pass it as one quoted argument with no `sh -c` of its own; several arguments are each shell-quoted into one command",
		})
		.action(async (opts, ctx) => {
			if (name === "probe") {
				ctx.log.error(
					"`splates signal probe` is deprecated: use `splates signal poll`",
				);
			}
			if (opts.every !== "") {
				ctx.log.error("`--every` is deprecated: use `--interval`");
			}
			const tooShort = checkDescription(opts.description);
			if (tooShort !== undefined) {
				throw new Error(tooShort);
			}
			const interval = opts.interval === "" ? opts.every : opts.interval;
			const id = await conversationOf(ctx.service, opts.conversation);
			const probe = await post(ctx, `/api/conversations/${id}/signal-probe`, {
				name: opts.name,
				description: opts.description,
				every: interval,
				timeout: opts.timeout,
				script: pollScript(opts.script),
			});
			ctx.log.info(
				probe.state === "raised"
					? `${color.green("raised")} ${opts.name}: its poll script passed on its first run`
					: probe.state === "running"
						? `${color.green("polling")} ${opts.name} every ${interval} until ${String(probe.deadline)}, for the waits on it`
						: `${color.green("poll script ready")} on ${opts.name}: it runs once \`splates signal wait ${opts.name}\` begins, then every ${interval} until ${String(probe.deadline)}`,
			);
		});
}

splatesSignal
	.command("poll-now")
	.use(repository({ needs: "own" }))
	.description(
		"run a signal's poll script once, now, even when the machine is busy: the run counts as any poll, a pass fires the signal (even when the last poll passed too), and the interval starts over from it. Needs a poll script running on the signal",
	)
	.arg("name", z.string(), { description: "the signal name or call" })
	.action(async (opts, ctx) => {
		const probe = await post(ctx, "/api/signals/poll-now", {
			name: opts.name,
		});
		const runs = Array.isArray(probe.runs)
			? (probe.runs as { exit: number; output: string }[])
			: [];
		const run = runs.at(-1);
		const passed = run?.exit === 0;
		ctx.log.info(
			passed
				? `${color.green("passed")}: fired ${opts.name}`
				: `${color.yellow("not yet")}: ${opts.name} did not fire (exit ${String(run?.exit)})`,
		);
		if (run !== undefined && run.output !== "") {
			ctx.log.info(run.output);
		}
	});

splatesSignal
	.command("expire")
	.use(repository({ needs: "own" }))
	.description(
		"set or clear automatic removal of a whole signal; waits end and automations pause at expiration",
	)
	.arg("name", z.string(), { description: "the signal name or call" })
	.option("after", z.string(), {
		default: "",
		description: "duration, as 2h or 7d",
	})
	.option("at", z.string(), {
		default: "",
		description: "ISO date or date/time with timezone",
	})
	.option("clear", z.boolean(), {
		default: false,
		description: "remove the expiration deadline",
	})
	.option("on-fire", z.boolean(), {
		default: false,
		description:
			"make the signal one-off: it expires as soon as it is fired, once its automations have run",
	})
	.action(async (opts, ctx) => {
		if (
			Number(opts.after !== "") +
				Number(opts.at !== "") +
				Number(opts.clear) +
				Number(opts["on-fire"]) !==
			1
		) {
			fail(
				"usage",
				"choose exactly one of --after, --at, --clear, or --on-fire",
				{},
			);
		}
		if (opts["on-fire"]) {
			await post(ctx, "/api/signals/expiration", {
				name: opts.name,
				onFire: true,
			});
			ctx.log.info(`${opts.name} expires once it is fired`);
			return;
		}
		const answer = await post(ctx, "/api/signals/expiration", {
			name: opts.name,
			expires: opts.clear ? null : opts.after || opts.at,
		});
		ctx.log.info(
			answer.expiresAt === null
				? `expiration cleared for ${opts.name}`
				: `${opts.name} expires at ${String(answer.expiresAt)}`,
		);
	});
