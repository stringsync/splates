import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { SystemTimer } from "webappwiz/time";
import type { Attachment } from "./attachments";
import { Exit, type Reason } from "./exit";
import { PULSE, PULSE_EVENT } from "./pulse";

/**
 * Which requests `arbor dev` answers at all: those to a host it may be
 * reached by, and writes only from its own page. Conversations and terminals
 * answer only to this machine's own names, never to a host `hosts` lets in,
 * so a tunnel still reaches no further than the todos.
 */
export class HostGate {
	private readonly allowed: Set<string>;

	constructor(
		hosts: string[],
		private readonly log: Logger,
	) {
		this.allowed = new Set([...LOCAL_HOSTS, ...hosts]);
	}

	// Every route that reads or writes the repo goes through here. The Host
	// check is what DNS rebinding runs into; the Origin check is what a form on
	// another site posting to this one runs into. A handler that upgrades the
	// connection answers nothing, and that passes through too.
	readonly guarded =
		<Answered extends Response | undefined>(
			handle: (request: Request) => Promise<Answered>,
		) =>
		async (request: Request): Promise<Answered | Response> => {
			const host = request.headers.get("host") ?? "";
			if (!this.allowed.has(hostname(host))) {
				return refuse(
					403,
					"forbidden",
					`host '${host}' is not allowed: pass it to --allow-hosts`,
				);
			}
			const origin = request.headers.get("origin");
			if (
				request.method !== "GET" &&
				(origin === null || new URL(origin).host !== host)
			) {
				return refuse(403, "forbidden", "cross-origin writes are refused");
			}
			try {
				return await handle(request);
			} catch (error) {
				if (error instanceof Exit) {
					return refuse(
						STATUS[error.reason] ?? 400,
						error.reason,
						error.message,
					);
				}
				this.log.error(String(error));
				return refuse(500, "error", String(error));
			}
		};

	// Refused, rather than missing, for any name but this machine's own: a
	// tunnel's visitor learns the feature exists, and nothing more.
	readonly local =
		<Answered extends Response | undefined>(
			handle: (request: Request) => Promise<Answered>,
		) =>
		async (request: Request): Promise<Answered | Response> =>
			LOCAL_HOSTS.includes(hostname(request.headers.get("host") ?? ""))
				? handle(request)
				: refuse(
						403,
						"forbidden",
						"conversations and terminals run commands on this machine: open the page on it",
					);
}

/** The one address the server binds: this machine, and nothing else. */
export const LOOPBACK = "127.0.0.1";

/** Names this machine answers to, which a page opened on it always may use. */
export const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** A phone photo or a short screen recording fits; a long video does not. */
export const MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * The images and recordings a todo or a task may hold, by extension, and how
 * each is served; `dev/media.tsx` shows the same ones inline.
 */
export const MEDIA_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
};

/** How a refusal from the core reads over HTTP. */
export const STATUS: Partial<Record<Reason, number>> = {
	usage: 400,
	not_found: 404,
	lease_held: 409,
	exists: 409,
	cycle: 409,
	outdated: 409,
};

/** An open server-sent event stream, as the server writes to it. */
export type EventSink = ReadableStreamDefaultController<Uint8Array>;

/** What a stream's owner does as pages join and leave it. */
export interface StreamWatcher {
	/** Called once a page's stream has joined the set. */
	opened(): void;
	/** Called once a page's stream has left the set. */
	closed(): void;
}

const encoder = new TextEncoder();

/**
 * A server-sent event stream, in `listeners` while its page holds it open,
 * pulsing so the page can tell it went quiet, and telling `watcher` as it
 * joins and leaves.
 */
export function eventStream(
	listeners: Set<EventSink>,
	watcher?: StreamWatcher,
): Response {
	let self: EventSink | null = null;
	let pulse: Resource | null = null;
	return new Response(
		new ReadableStream<Uint8Array>({
			start: (stream) => {
				self = stream;
				pulse = pulsing(stream);
				listeners.add(stream);
				watcher?.opened();
				// A comment, ignored by EventSource. Without a first chunk the
				// response headers never reach the client and the page hangs
				// waiting to connect.
				stream.enqueue(encoder.encode(": connected\n\n"));
			},
			cancel: () => {
				pulse?.dispose();
				if (self) {
					listeners.delete(self);
				}
				watcher?.closed();
			},
		}),
		{
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
			},
		},
	);
}

/** The JSON a write sends, as an object. */
export async function body(request: Request): Promise<Record<string, unknown>> {
	const read = (await request.json().catch(() => ({}))) as unknown;
	return typeof read === "object" && read !== null
		? (read as Record<string, unknown>)
		: {};
}

/** The files a form carries under `file`, as bytes. */
export async function uploads(form: FormData): Promise<Attachment[]> {
	const files: Attachment[] = [];
	for (const file of form.getAll("file")) {
		if (file instanceof File) {
			files.push({
				name: file.name || "pasted",
				bytes: new Uint8Array(await file.arrayBuffer()),
			});
		}
	}
	return files;
}

/**
 * `bytes`, served as `type`, or to download when it is not an image or a
 * recording, in the part `request` asks for: Safari plays a video only from a
 * server that hands out its parts.
 */
export function fileResponse(
	request: Request,
	bytes: Uint8Array,
	type: string | undefined,
	headers: Record<string, string>,
): Response {
	const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
	const start = range?.[1] ? Number(range[1]) : null;
	const end = range?.[2] ? Number(range[2]) : null;
	const first = start ?? (end === null ? 0 : Math.max(bytes.length - end, 0));
	const last =
		start !== null && end !== null
			? Math.min(end, bytes.length - 1)
			: bytes.length - 1;
	const partial = range !== null && first <= last;
	const sent = partial ? bytes.subarray(first, last + 1) : bytes;
	return new Response(new Blob([sent as Uint8Array<ArrayBuffer>]), {
		status: partial ? 206 : 200,
		headers: {
			...headers,
			"content-type": type ?? "application/octet-stream",
			"accept-ranges": "bytes",
			...(partial
				? { "content-range": `bytes ${first}-${last}/${bytes.length}` }
				: {}),
			...(type === undefined ? { "content-disposition": "attachment" } : {}),
			// An svg opened on its own could otherwise run a script.
			"content-security-policy":
				"default-src 'none'; style-src 'unsafe-inline'",
			"x-content-type-options": "nosniff",
		},
	});
}

/** The host a Host header names, without its port. */
export function hostname(host: string): string {
	return host.startsWith("[")
		? host.slice(0, host.indexOf("]") + 1)
		: (host.split(":")[0] ?? "");
}

/** `text` as JSON, or null when it is not. */
export function json(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

export function refuse(
	status: number,
	reason: string,
	message: string,
): Response {
	return Response.json({ reason, message }, { status });
}

/**
 * Says to `stream`'s page, every pulse, that it is still there, so a page
 * whose stream went quiet, as across a sleep, opens it again.
 */
export function pulsing(stream: EventSink): Resource {
	return new SystemTimer().setInterval(() => {
		try {
			stream.enqueue(PULSE_EVENT);
		} catch {
			// Closed on the way: its `cancel` stops this.
		}
	}, PULSE);
}
