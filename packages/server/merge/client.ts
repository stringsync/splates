import { color, type Logger } from "core/log";
import { Duration, sleep } from "core/time";
import { EXIT, Exit, fail, type Reason } from "../exit";
import type { Facts } from "../records";
import type { ServerOf } from "../workers";
import type { MergeAnswer, MergeAsk } from "./served";

/** How long a read of the merge may take, past the server's own wait for news. */
const READ_TIMEOUT_MS = 40_000;
/** How long the first ask may take to be taken. */
const ASK_TIMEOUT_MS = 30_000;

/** How `mergeOnServer` came out when it did not refuse. */
export type ServedOutcome = "landed" | "unreachable";

/**
 * Hands `ask`'s merge to the `splates server`, prints what it says as this
 * command's own, and ends as it ends: returns once it landed, or throws its
 * refusal. A server that cannot be reached at the first ask answers
 * `unreachable`, for the command to merge itself; one lost later is waited
 * for, `lostAfterMs` at most, and asked again, which resumes the merge
 * there or reads the end it kept.
 */
export async function mergeOnServer(
	{
		server,
		slug,
		log,
		retryMs = 2000,
		lostAfterMs = 10 * 60_000,
	}: {
		server: ServerOf;
		/** The project, as `?project=` names it. */
		slug: string;
		log: Logger;
		retryMs?: number;
		lostAfterMs?: number;
	},
	ask: MergeAsk,
	facts: Partial<Facts["merge"]>,
): Promise<ServedOutcome> {
	const { url, send } = server;
	const project = `project=${encodeURIComponent(slug)}`;
	const of = `${url}/api/merges/${encodeURIComponent(ask.task)}`;
	const post = async (): Promise<"asked" | "unreachable"> => {
		const response = await send(`${url}/api/merges?${project}`, {
			method: "POST",
			headers: { origin: url, "content-type": "application/json" },
			body: JSON.stringify(ask),
			signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
		}).catch(() => null);
		// A server older than served merges has no such route.
		if (
			response === null ||
			(response.status === 404 &&
				!response.headers.get("content-type")?.includes("json"))
		) {
			return "unreachable";
		}
		if (!response.ok) {
			throw await refusal(response);
		}
		return "asked";
	};
	if ((await post()) === "unreachable") {
		return "unreachable";
	}
	let from = 0;
	let lostSince: number | null = null;
	for (;;) {
		const response = await send(`${of}?${project}&from=${from}`, {
			headers: { origin: url },
			signal: AbortSignal.timeout(READ_TIMEOUT_MS),
		}).catch(() => null);
		if (response === null || response.status >= 500) {
			lostSince ??= Date.now();
			if (Date.now() - lostSince > lostAfterMs) {
				fail(
					"blocked",
					`lost the splates server at ${url} for ${Duration.ms(lostAfterMs).human()} while it merged '${ask.task}'. Whatever it got to is in the task's record: merge again once it is back.`,
					{ task: ask.task },
				);
			}
			await sleep(Duration.ms(retryMs));
			continue;
		}
		if (response.status === 404) {
			// A server that restarted holds no merge until asked again.
			if ((await post()) === "unreachable") {
				lostSince ??= Date.now();
				await sleep(Duration.ms(retryMs));
				continue;
			}
			if (lostSince !== null || from > 0) {
				log.info(
					`${color.yellow("merging again")}: the splates server restarted during the merge`,
				);
			}
			lostSince = null;
			from = 0;
			continue;
		}
		if (!response.ok) {
			throw await refusal(response);
		}
		lostSince = null;
		const answer = (await response.json()) as MergeAnswer;
		for (const line of answer.lines) {
			if (line.level === "error") {
				log.error(line.text);
			} else {
				log.info(line.text);
			}
		}
		from = answer.next;
		if (answer.end === null) {
			continue;
		}
		await send(`${of}?${project}&pid=${ask.pid}`, {
			method: "DELETE",
			headers: { origin: url },
			signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
		}).catch(() => null);
		const { end } = answer;
		Object.assign(facts, end.facts);
		if (end.exit !== undefined) {
			throw new Exit(end.exit.reason, end.exit.message, end.exit.data);
		}
		if (end.error !== undefined) {
			throw new Error(`the splates server's merge broke: ${end.error}`);
		}
		return "landed";
	}
}

/** The refusal a server's answer carries, as this command's own. */
async function refusal(response: Response): Promise<Exit> {
	const body = (await response.json().catch(() => null)) as {
		reason?: string;
		message?: string;
	} | null;
	const reason = body?.reason ?? "";
	return new Exit(
		reason in EXIT ? (reason as Reason) : "merge_failed",
		body?.message ?? `the splates server answered ${response.status}`,
	);
}
