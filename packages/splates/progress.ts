import { conversationOf } from "@splates/server/conversations";
import { EXIT, fail, type Reason } from "@splates/server/exit";
import type { Repository } from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import { SERVER_WAIT_MS } from "@splates/server/tasks";
import { serverOf } from "@splates/server/workers";

/** How often a streamed run sends the newest line it has read. */
const SEND_EVERY_MS = 500;

/** What `splates progress` was given. */
export interface ProgressOptions {
	id: string;
	text?: string | undefined;
	title: string;
	percent?: number | undefined;
	done: boolean;
	failed: boolean;
	conversation: string;
}

/** `splates progress`: one update, or stdin streamed as updates. */
export async function runProgress(
	ctx: SplatesDeps & Repository,
	opts: ProgressOptions,
): Promise<void> {
	{
		if (opts.done && opts.failed) {
			fail("usage", "a task is done or failed, not both: nothing was sent");
		}
		const id = await conversationOf(ctx.service, opts.conversation);
		const server = await serverOf(ctx);
		const state = opts.done ? "done" : opts.failed ? "failed" : undefined;
		const base = {
			id: opts.id,
			...(opts.title === "" ? {} : { title: opts.title }),
			...(state === undefined ? {} : { state }),
		};
		let last: Record<string, unknown> = { ...base, percent: opts.percent };
		const send = async (update: Record<string, unknown>): Promise<void> => {
			last = update;
			if (server === null) {
				return;
			}
			const response = await server
				.send(`${server.url}/api/conversations/${id}/progress`, {
					method: "POST",
					headers: { origin: server.url, "content-type": "application/json" },
					body: JSON.stringify(update),
					signal: AbortSignal.timeout(SERVER_WAIT_MS),
				})
				.catch(() => null);
			if (response !== null && !response.ok) {
				const refused = (await response.json().catch(() => ({}))) as {
					reason?: string;
					message?: string;
				};
				const reason = refused.reason as Reason;
				fail(
					reason in EXIT ? reason : "usage",
					refused.message ?? `splates server refused it: ${response.status}`,
				);
			}
		};
		if (opts.text === "-") {
			await stream(base, opts.percent, send);
		} else {
			await send({ ...base, percent: opts.percent, note: opts.text });
		}
		ctx.log.info(
			`${server === null ? "(no splates server: not shown) " : ""}${describe(last)}`,
		);
	}
}

/**
 * Reads stdin line by line, sending the newest line every `SEND_EVERY_MS`
 * and once more at the end, so a fast command costs a few requests, not one
 * per line. The server holds back what a burst still sends.
 */
async function stream(
	base: Record<string, unknown>,
	percent: number | undefined,
	send: (update: Record<string, unknown>) => Promise<void>,
): Promise<void> {
	let newest: Record<string, unknown> | null = null;
	let sending: Promise<void> = Promise.resolve();
	const flush = (): void => {
		if (newest !== null) {
			const update = newest;
			newest = null;
			sending = sending.then(() => send(update));
		}
	};
	const every = setInterval(flush, SEND_EVERY_MS);
	const decoder = new TextDecoder();
	let pending = "";
	const read = (line: string): void => {
		const text = line.trim();
		if (text === "") {
			return;
		}
		const found = /(?<![\d.])(\d{1,3})%/.exec(text);
		newest = {
			...base,
			note: text,
			percent: percent ?? (found === null ? undefined : Number(found[1])),
		};
	};
	try {
		for await (const chunk of Bun.stdin.stream()) {
			pending += decoder.decode(chunk, { stream: true });
			const lines = pending.split(/\r\n|\r|\n/);
			pending = lines.pop() ?? "";
			lines.forEach(read);
		}
		read(pending);
	} finally {
		clearInterval(every);
	}
	if (newest === null) {
		newest = { ...base, percent };
	}
	flush();
	await sending;
}

/** The card as one plain line, which is all a terminal with no page shows. */
function describe(update: Record<string, unknown>): string {
	const state = update.state;
	const mark = state === "done" ? "✅" : state === "failed" ? "❌" : "⏳";
	const percent =
		typeof update.percent === "number" ? ` ${update.percent}%` : "";
	const note = typeof update.note === "string" ? ` · ${update.note}` : "";
	return `${mark} ${String(update.title ?? update.id)}${percent}${note}`;
}
