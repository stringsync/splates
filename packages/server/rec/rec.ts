import type { Child, Ps } from "core/system";
import { z } from "zod";
import { isLocal } from "../server/http";
import type { Handler } from "../server/shared";
import { body } from "../server/shared";
import type {
	RecOpen,
	RecSessionDetail,
	RecSessionMatch,
	RecSessions,
	RecSource,
	RecState,
	RecStatus,
} from "./browser";
import { REC_STORE_POLICY } from "./browser";
import { logEntries, mergeEntries, timelineFileEntries } from "./timeline";

const STATUS = z.object({
	running: z.boolean(),
	name: z.string().optional(),
	recording: z.boolean().optional(),
	startedAt: z.number().optional(),
	mic: z.enum(["on", "off"]).optional(),
	laser: z.boolean().optional(),
	lastOutcome: z
		.discriminatedUnion("status", [
			z.object({ status: z.literal("saved"), name: z.string() }),
			z.object({ status: z.literal("failed"), reason: z.string() }),
		])
		.optional(),
});

const SOURCES = z.object({
	containers: z.array(
		z.object({ name: z.string(), project: z.string().optional() }),
	),
	error: z.string().optional(),
});

const OPEN = z.object({
	name: z.string().min(1),
	url: z.string().min(1),
	docker: z.array(z.string()),
	tails: z.array(z.string()),
});

/**
 * Lets the Rec page see whether rec is there and running, and open a session.
 * Ask `state()` for the page, call `open()` with the choices to start Chrome.
 */
/**
 * A process recording, however it was started: `rec record`, bare `rec --url`
 * (recording is rec's fallback command), or `bin/rec`, which runs the package's
 * `index.ts`. Other subcommands, such as `rec sessions list`, do not match.
 */
const RECORDING_COMMAND =
	/(^|[ /])rec(\/packages\/rec\/index\.ts)?( record)?( --.*)?$/;

export class Rec {
	readonly #ps: Ps;
	/** The rec this server started, while it runs. */
	#child: Child | null = null;

	constructor(ps: Ps) {
		this.#ps = ps;
	}

	/** Runs `rec <args>`, and what it printed; null when it is missing or fails. */
	async #run(args: string[]): Promise<string | null> {
		try {
			const done = await this.#ps.spawnCapture(["rec", ...args], {
				timeoutMs: 10_000,
			});
			return done.exitCode === 0 ? done.stdout : null;
		} catch {
			return null;
		}
	}

	/** An unused session name. */
	async suggestName(): Promise<string | null> {
		const out = await this.#run(["suggest-name"]);
		return out === null ? null : out.trim() || null;
	}

	async state(): Promise<RecState> {
		const [status, sources] = await Promise.all([
			this.#run(["status", "--json"]),
			this.#run(["sources", "--json"]),
		]);
		const host = this.#ps.hostname;
		if (status === null) {
			return {
				available: false,
				host,
				status: { running: false },
				sources: [],
			};
		}
		const parsed = STATUS.safeParse(JSON.parse(status));
		const listed =
			sources === null ? null : SOURCES.safeParse(JSON.parse(sources));
		return {
			available: true,
			host,
			project: composeProject(this.#ps.cwd()),
			status: parsed.success
				? (parsed.data satisfies RecStatus)
				: { running: false },
			sources: listed?.success
				? listed.data.containers.map(
						(box): RecSource => ({
							kind: "docker",
							name: box.name,
							...(box.project ? { project: box.project } : {}),
						}),
					)
				: [],
			...(listed?.success && listed.data.error
				? { sourcesError: listed.data.error }
				: {}),
		};
	}

	/** Starts rec, which keeps running until the person finishes in Chrome. */
	open(what: RecOpen): void {
		const argv = ["rec", "record", "--name", what.name, "--url", what.url];
		if (what.docker.length > 0) {
			argv.push(`--docker=${what.docker.join(",")}`);
		}
		for (const path of what.tails) {
			argv.push("--tail", path);
		}
		const child = this.#ps.start(argv);
		// Unread output would fill the pipe and stop it.
		for (const stream of [child.stdout, child.stderr]) {
			void stream.pipeTo(new WritableStream()).catch(() => {});
		}
		this.#child = child;
		child.exited.then(
			() => {
				if (this.#child === child) {
					this.#child = null;
				}
			},
			() => {},
		);
	}

	/**
	 * Ends the running rec, the way out when Chrome never shows or answers.
	 * False when no rec runs.
	 */
	async interrupt(): Promise<boolean> {
		const child = this.#child;
		if (child === null) {
			// Started elsewhere (a terminal, or before this server restarted).
			return this.#interruptStranger();
		}
		child.kill("SIGINT");
		const gone = await Promise.race([
			child.exited.then(
				() => true,
				() => true,
			),
			new Promise<boolean>((resolve) => setTimeout(resolve, 5000, false)),
		]);
		if (!gone) {
			child.kill("SIGKILL");
		}
		return true;
	}

	/** Interrupts `rec record` processes this server has no handle on. */
	async #interruptStranger(): Promise<boolean> {
		const found = (await this.#ps.processes()).filter(
			(each) =>
				each.pid !== this.#ps.pid && RECORDING_COMMAND.test(each.command),
		);
		for (const each of found) {
			await this.#ps.spawn(["kill", "-INT", String(each.pid)]);
		}
		return found.length > 0;
	}

	/** Every saved session, newest first. */
	async sessions(): Promise<RecSessions | null> {
		const out = await this.#run(["sessions", "list", "--json"]);
		if (out === null) {
			return null;
		}
		const listed = JSON.parse(out) as Omit<RecSessions, "policy">;
		return { ...listed, policy: REC_STORE_POLICY };
	}

	/** One session with its moments and files; null when rec has no such session. */
	async session(name: string): Promise<RecSessionDetail | null> {
		const out = await this.#run(["sessions", "show", name]);
		if (out === null) {
			return null;
		}
		const shown = JSON.parse(out) as {
			folder: string;
			momentList: RecSessionDetail["momentList"];
			timeline?: string;
			stills: string[];
			logs: string[];
		} & Omit<
			RecSessionDetail,
			"momentList" | "stills" | "logs" | "video" | "entries"
		>;
		const base = (path: string) => path.split("/").pop() ?? path;
		const video = await this.#video(shown.folder);
		const timeline =
			shown.timeline === undefined
				? undefined
				: await Bun.file(shown.timeline)
						.text()
						.catch(() => undefined);
		const logLists = await Promise.all(
			shown.logs.map(async (path) =>
				logEntries(
					base(path),
					await Bun.file(path)
						.text()
						.catch(() => ""),
					shown.startedAt,
				),
			),
		);
		return {
			...shown,
			timeline,
			entries: mergeEntries(timelineFileEntries(timeline ?? ""), ...logLists),
			stills: shown.stills.map(base),
			logs: shown.logs.map(base),
			video: video !== null,
		};
	}

	async #video(folder: string): Promise<string | null> {
		for (const file of ["recording.webm", "recording.mp4"]) {
			if (await Bun.file(`${folder}/${file}`).exists()) {
				return `${folder}/${file}`;
			}
		}
		return null;
	}

	/** A file of a session served in the part asked for, so a video can seek. */
	async #serve(
		request: Request,
		path: string,
		type: string,
	): Promise<Response> {
		const file = Bun.file(path);
		if (!(await file.exists())) {
			return new Response("not found", { status: 404 });
		}
		const size = file.size;
		const range = /^bytes=(\d*)-(\d*)$/.exec(
			request.headers.get("range") ?? "",
		);
		const headers = {
			"content-type": type,
			"accept-ranges": "bytes",
			"x-content-type-options": "nosniff",
			"content-security-policy": "default-src 'none'",
		};
		if (range === null || (range[1] === "" && range[2] === "")) {
			return new Response(file, { headers });
		}
		const first = range[1]
			? Number(range[1])
			: Math.max(size - Number(range[2]), 0);
		const last =
			range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
		if (first > last) {
			return new Response(null, {
				status: 416,
				headers: { "content-range": `bytes */${size}` },
			});
		}
		return new Response(file.slice(first, last + 1), {
			status: 206,
			headers: {
				...headers,
				"content-range": `bytes ${first}-${last}/${size}`,
			},
		});
	}

	/** The session name a request's path holds: `/api/rec/sessions/<name>/...`. */
	#named(request: Request): string {
		const name = decodeURIComponent(
			new URL(request.url).pathname.split("/")[4] ?? "",
		);
		// A leading dash would read as an option of the rec command.
		return name.startsWith("-") ? "" : name;
	}

	readonly list: Handler = async () => {
		const listed = await this.sessions();
		return listed === null
			? new Response("rec is not available", { status: 503 })
			: Response.json(listed);
	};

	readonly search: Handler = async (request) => {
		const query = new URL(request.url).searchParams.get("q") ?? "";
		const out = await this.#run(["sessions", "search", "--json", query]);
		return out === null
			? new Response("rec is not available", { status: 503 })
			: Response.json(JSON.parse(out) as RecSessionMatch[]);
	};

	readonly detail: Handler = async (request) => {
		const found = await this.session(this.#named(request));
		return found === null
			? new Response("no such session", { status: 404 })
			: Response.json(found);
	};

	readonly video: Handler = async (request) => {
		const found = await this.session(this.#named(request));
		const path = found === null ? null : await this.#video(found.folder);
		return path === null
			? new Response("no recording", { status: 404 })
			: this.#serve(
					request,
					path,
					path.endsWith(".mp4") ? "video/mp4" : "video/webm",
				);
	};

	/** A still or a log of a session, only by a name rec listed for it. */
	readonly file: Handler = async (request) => {
		const parts = new URL(request.url).pathname.split("/");
		const kind = parts[5];
		const file = decodeURIComponent(parts[6] ?? "");
		const found = await this.session(this.#named(request));
		if (found === null) {
			return new Response("no such session", { status: 404 });
		}
		if (kind === "still" && found.stills.includes(file)) {
			return this.#serve(
				request,
				`${found.folder}/frames/${file}`,
				"image/jpeg",
			);
		}
		if (kind === "log" && found.logs.includes(file)) {
			return this.#serve(
				request,
				`${found.folder}/logs/${file}`,
				"text/plain; charset=utf-8",
			);
		}
		return new Response("not found", { status: 404 });
	};

	readonly rename: Handler = async (request) => {
		const parsed = z
			.object({ to: z.string().min(1) })
			.safeParse(await body(request));
		if (!parsed.success) {
			return new Response("a new name is needed", { status: 400 });
		}
		const done = await this.#run([
			"sessions",
			"rename",
			this.#named(request),
			parsed.data.to,
		]);
		return done === null
			? new Response("rec could not rename it", { status: 409 })
			: new Response(null, { status: 204 });
	};

	readonly remove: Handler = async (request) => {
		const done = await this.#run(["sessions", "delete", this.#named(request)]);
		return done === null
			? new Response("rec could not delete it", { status: 404 })
			: new Response(null, { status: 204 });
	};

	readonly openFolder: Handler = async (request) => {
		const out = await this.#run(["sessions", "path", this.#named(request)]);
		if (out === null) {
			return new Response("no such session", { status: 404 });
		}
		await this.#ps
			.spawnCapture(["open", out.trim()], { timeoutMs: 10_000 })
			.catch(() => {});
		return new Response(null, { status: 204 });
	};

	readonly read: Handler = async (request) =>
		Response.json({
			...(await this.state()),
			here: isLocal(request.headers.get("host") ?? ""),
		});

	readonly name: Handler = async () => {
		const name = await this.suggestName();
		return name === null
			? new Response("rec is not available", { status: 503 })
			: Response.json({ name });
	};

	readonly start: Handler = async (request) => {
		const parsed = OPEN.safeParse(await body(request));
		if (!parsed.success) {
			return new Response("name, url, docker and tails are needed", {
				status: 400,
			});
		}
		const what = parsed.data;
		if ((await this.state()).status.running) {
			return new Response("rec is already running", { status: 409 });
		}
		if ((await this.suggestName()) === null) {
			return new Response("rec is not available", { status: 503 });
		}
		this.open(what);
		return new Response(null, { status: 204 });
	};

	readonly stop: Handler = async () =>
		(await this.interrupt())
			? new Response(null, { status: 204 })
			: Response.json(
					{ reason: "no_rec", message: "no running rec was found to close" },
					{ status: 409 },
				);
}

/** The name Compose gives a project that lives in `cwd`. */
function composeProject(cwd: string): string {
	return (cwd.split("/").pop() ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
}
