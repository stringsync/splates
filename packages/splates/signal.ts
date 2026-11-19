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

splatesSignal
	.command("raise")
	.use(repository({ needs: "own" }))
	.description(
		"raise a signal, as `mdom.released`, with an optional JSON payload: every conversation waiting on it at this moment wakes with it. Any agent may raise freely. Raising it again later is a new raise",
	)
	.arg("name", z.string(), {
		description: "the signal, as <project>.<name>",
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
		const task = await here(ctx);
		const by = task ?? (await conversationOf(ctx.service, opts.conversation));
		const answer = await post(ctx, "/api/signals/raise", {
			name: opts.name,
			by,
			payload,
		});
		ctx.log.info(
			`${color.green("raised")} ${opts.name}: ${String(answer.delivered)} waiting conversation${answer.delivered === 1 ? "" : "s"} woken`,
		);
	});

splatesSignal
	.command("wait")
	.use(repository({ needs: "own" }))
	.description(
		"wait for a signal by ending your turn: the conversation shows one card and wakes with `[SPLATES SIGNAL <name>]` and the payload when it is raised, or with `timeout` once --timeout passes, or `stopped` when the person stops it. Only a raise after the wait begins counts, unless --since takes one from before. End your turn right after it. The conversation is $SPLATES_CONVERSATION, or --conversation <id> from an agent outside `splates server`",
	)
	.arg("name", z.string(), {
		description: "the signal, as <project>.<name>",
	})
	.option("timeout", z.string(), {
		default: "",
		description: "how long to wait, as 30m, 2h or 1d (7d at most); required",
	})
	.option("description", z.string(), {
		default: "",
		description:
			"what you wait for, in one short line: the card shows it in every state; required",
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

splatesSignal
	.command("probe")
	.use(repository({ needs: "own" }))
	.description(
		"attach a probe to a signal: a shell script, given after --, that the server runs in this project's main tree while something waits on the signal: at once when a wait begins, then every --every (30s at the most often), skipping runs while the machine is busy. A run that exits 0 after a failing one, or a wait's first run that exits 0, raises the signal with the script's stdout (JSON if it parses) and checkedAt. It stops once raised with nothing left waiting, when its last wait ends, at --timeout (waking its waits with `timeout`), or when the person stops it. Probing a signal again replaces its probe, and its waits stay. Needs no approval; the conversation shows its card. Then `splates signal wait` on it",
	)
	.arg("name", z.string(), {
		description: "the signal, as <project>.<name>",
	})
	.option("every", z.string(), {
		default: "",
		description: "how often to run it, as 30s, 5m or 1h; required",
	})
	.option("timeout", z.string(), {
		default: "",
		description: "when it stops, as 30m, 6h or 1d (7d at most); required",
	})
	.option("description", z.string(), {
		default: "",
		description:
			"what it checks for, in one short line: its card shows it; required",
	})
	.option("conversation", z.string(), {
		default: "",
		description:
			"conversation id, when not run by an agent `splates server` started",
	})
	.rest("script", z.string(), {
		description:
			"the script, after --, run with `sh -c`; exit 0 means the condition holds",
	})
	.action(async (opts, ctx) => {
		const id = await conversationOf(ctx.service, opts.conversation);
		const probe = await post(ctx, `/api/conversations/${id}/signal-probe`, {
			name: opts.name,
			description: opts.description,
			every: opts.every,
			timeout: opts.timeout,
			script: opts.script.join(" "),
		});
		ctx.log.info(
			probe.state === "raised"
				? `${color.green("raised")} ${opts.name}: its probe passed on its first run`
				: probe.state === "running"
					? `${color.green("probing")} ${opts.name} every ${opts.every} until ${String(probe.deadline)}, for the waits on it`
					: `${color.green("probe ready")} on ${opts.name}: it runs once \`splates signal wait ${opts.name}\` begins, then every ${opts.every} until ${String(probe.deadline)}`,
		);
	});
