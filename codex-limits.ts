import { Duration, type Timer } from "webappwiz/time";
import type { Agent, Launch, Limit } from "./conversations";

/** How long Codex's app server gets to say its limits before it is let go. */
const WAIT = Duration.secs(15);

/** What Claude calls the windows Codex has too, by their length in minutes. */
const NAMED: Record<number, string> = { 300: "five_hour", 10080: "seven_day" };

/** One of Codex's windows, as its app server says it. */
interface CodexWindow {
	usedPercent: number;
	windowDurationMins: number | null;
	/** In seconds. */
	resetsAt: number | null;
}

/** Whether `agent` is Codex's ACP adapter, which says its limits only in `/status`. */
export function isCodex(agent: Agent): boolean {
	return agent.argv.some((each) => each.includes("codex-acp"));
}

/**
 * Asks Codex's app server, the one its ACP adapter runs, for the plan's
 * windows, since the adapter never sends them: a window Claude also has goes
 * by Claude's name, any other by its length, as `43200_minutes`. None when
 * Codex will not say.
 */
export async function codexLimits(deps: {
	launch: Launch;
	timer: Timer;
	now: () => number;
	/** Where it runs: anywhere does, since the plan is the account's. */
	cwd: string;
	/** Where `codex` is, as the adapter reads it; `codex` on the path otherwise. */
	codex?: string;
}): Promise<Limit[]> {
	const server = deps.launch(
		[deps.codex ?? "codex", "app-server"],
		deps.cwd,
		{},
	);
	const writer = server.input.getWriter();
	// Not waited on: a server held up writing its answer is read meanwhile.
	const send = (message: object) =>
		void writer
			.write(new TextEncoder().encode(`${JSON.stringify(message)}\n`))
			.catch(() => {});
	let giveUp = (_: null) => {};
	const timedOut = new Promise<null>((resolve) => (giveUp = resolve));
	const wait = deps.timer.setTimeout(() => giveUp(null), WAIT);
	const answer = (async () => {
		send({
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "arbor", title: "arbor", version: "1" } },
		});
		const decoder = new TextDecoder();
		let buffered = "";
		for await (const chunk of server.output) {
			buffered += decoder.decode(chunk, { stream: true });
			const lines = buffered.split("\n");
			buffered = lines.pop() ?? "";
			for (const line of lines) {
				const message = JSON.parse(line) as {
					id?: number;
					result?: {
						rateLimits?: {
							primary?: CodexWindow | null;
							secondary?: CodexWindow | null;
						};
					};
				};
				if (message.id === 1) {
					send({ method: "initialized" });
					send({ id: 2, method: "account/rateLimits/read" });
				} else if (message.id === 2) {
					return message.result?.rateLimits ?? null;
				}
			}
		}
		return null;
	})().catch(() => null);
	try {
		const limits = await Promise.race([answer, timedOut]);
		const at = new Date(deps.now()).toISOString();
		return [limits?.primary, limits?.secondary].flatMap((window) =>
			window?.windowDurationMins == null || window.resetsAt == null
				? []
				: [
						{
							window:
								NAMED[window.windowDurationMins] ??
								`${window.windowDurationMins}_minutes`,
							used: window.usedPercent / 100,
							resets: new Date(window.resetsAt * 1000).toISOString(),
							at,
						},
					],
		);
	} finally {
		wait.dispose();
		server.kill();
	}
}
