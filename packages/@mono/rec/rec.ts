// vet-ignore-file compact-files: existing CLI command wiring stays together; retention is implemented in session-store.ts
import { aborts } from "core/abort";
import { cli, type Deps } from "core/cmd";
import type { Fs } from "core/system";
import { Duration, type WallClock } from "core/time";
import { z } from "zod";
import { BENCH_PAGE, summarize, summarizeCpu } from "./bench";
import { BenchDriver, benchVideo, probe } from "./bench-drive";
import { CdpSocket } from "./cdp";
import { Chrome, parseActivePort } from "./chrome";
import { listContainers } from "./docker";
import { Jev, optionalJevKey } from "./jev";
import { RecClient, serverFile } from "./mark";
import { writeMoments } from "./moments-files";
import { RecorderServer, type Routes } from "./recorder";
import { DEFAULT_MAX_FPS } from "./screencast";
import { Scrubber } from "./scrub";
import type { Manifest } from "./session";
import { SessionNames, sessionName, suggestName } from "./session-name";
import { SESSION_STORE_POLICY, SessionStore } from "./session-store";
import { SessionLibrary } from "./sessions";
import type { SessionDirs } from "./sinks";
import { BUNDLED_SKILL, installSkill } from "./skills";
import { parseVideoTime, sliceSession } from "./slice";
import { KEY_NAME, recCredentials, requireKey, transcribe } from "./transcribe";

export interface RecDeps extends Deps {
	fs: Fs;
	wall: WallClock;
}

export const rec = cli<RecDeps>("rec").fallback("record");

/** Where rec keeps its Chrome profile. */
function home(deps: RecDeps): string {
	return `${deps.ps.env("HOME") ?? deps.ps.cwd()}/.rec`;
}

/** The session folder: `--out` when given, else `~/.rec/sessions/<time>`. */
export function sessionDir(deps: RecDeps, out: string | undefined): string {
	const stamp = new Date(deps.wall.now())
		.toISOString()
		.slice(0, 19)
		.replace(/[:T]/g, "-");
	return out ?? `${home(deps)}/sessions/${stamp}`;
}

/** A session folder that does not exist yet: `sessionDir`'s, else it with `-2`, `-3` and so on. */
async function freshDir(
	deps: RecDeps,
	out: string | undefined,
): Promise<string> {
	const base = sessionDir(deps, out);
	let dir = base;
	for (let attempt = 2; await deps.fs.exists(dir); attempt++) {
		dir = `${base}-${attempt}`;
	}
	return dir;
}

/** A scrubber for the values in the `.env` files of the directory rec runs in. */
async function envScrubber(deps: RecDeps): Promise<Scrubber> {
	const dir = deps.ps.cwd();
	const names = (await deps.fs.readdir(dir).catch(() => [] as string[]))
		.filter((name) => name === ".env" || name.startsWith(".env."))
		.sort();
	return Scrubber.fromEnvFiles(
		await Promise.all(names.map((name) => deps.fs.read(`${dir}/${name}`))),
	);
}

interface Session {
	chrome: Chrome;
	server: RecorderServer;
}

interface OpenSessionOptions {
	fakeMedia: boolean;
	routes?: Routes;
	docker?: string;
	tails?: string[];
	staged?: boolean;
	noMic?: boolean;
	liveKey?: string;
	fps?: number;
	noScreencast?: boolean;
	name?: string;
	usedNames?: ReadonlySet<string>;
	/** Gives up opening, closing the Chrome it started, and rejects. */
	signal?: AbortSignal;
	/** The names of saved sessions still being processed, for `rec status`. */
	processing?: () => string[];
}

async function openSession(
	deps: RecDeps,
	dir: string | SessionDirs,
	url: (server: RecorderServer) => string,
	opts: OpenSessionOptions,
): Promise<Session> {
	const signal = opts.signal ?? new AbortController().signal;
	const server = new RecorderServer(deps, dir, {
		routes: opts.routes,
		baseName: opts.name,
		usedNames: opts.usedNames,
		micFile: `${home(deps)}/mic.json`,
		processing: opts.processing,
	});
	const file = serverFile(home(deps));
	await deps.fs.mkdir(home(deps), { recursive: true });
	await deps.fs.write(
		file,
		JSON.stringify({ origin: server.origin, name: opts.name }),
	);
	try {
		const chrome = await Chrome.launch(deps.ps, deps.fs, {
			profile: `${home(deps)}/chrome`,
			url: server.openUrl,
			fakeMedia: opts.fakeMedia,
			signal,
		});
		try {
			const opened = server.open(chrome.cdp, {
				grantMic: !opts.fakeMedia,
				workingUrl: url(server),
				scrubber: await envScrubber(deps),
				docker: opts.docker,
				tails: opts.tails,
				staged: opts.staged,
				noMic: opts.noMic,
				liveKey: opts.liveKey,
				fps: opts.fps,
				noScreencast: opts.noScreencast,
			});
			// A Chrome that stops answering would hold `open` up for good.
			await aborts.race(signal, opened);
			return { chrome, server };
		} catch (error) {
			await chrome.close();
			throw error;
		}
	} catch (error) {
		server.dispose();
		await deps.fs.rm(file, { force: true });
		throw error;
	}
}

rec
	.command("record")
	.description(
		`open Chrome with a working window and a control window, and record the active tab and the mic until stopped. ${SESSION_STORE_POLICY}`,
	)
	.option("url", z.string(), {
		default: "about:blank",
		description: "what the working window opens on",
	})
	.option("out", z.string().optional(), {
		description: SESSION_STORE_POLICY,
	})
	.option("name", sessionName.optional(), {
		description: "session name: lowercase words joined by hyphens",
	})
	.option("names", z.string().default(""), {
		description:
			"comma-separated project names for the transcript's prompt, besides the folder's own",
	})
	.option("docker", z.string().optional(), {
		description:
			"follow containers' logs: bare for the Compose project in the cwd (else every running container), or =<ids or names>",
	})
	.repeated("tail", z.string(), {
		description:
			"follow a file's lines, as <path> or <path>@-5m to backfill the last 5 minutes (s, m or h)",
	})
	.option("no-mic", z.boolean().default(false), {
		description:
			"record no audio and skip the transcript: an agent narrates with `rec mark`",
	})
	.option("fps", z.coerce.number().positive(), {
		default: DEFAULT_MAX_FPS,
		description:
			"the most frames per second sent to the control window; a high-refresh display paints more than a recording needs",
	})
	.action(async (opts, deps) => {
		// vet-ignore classes-over-function-exports: shared filesystem service owns scanning and selection for both CLI commands
		const names = new SessionNames(deps.fs);
		const used = await names.available(
			home(deps),
			deps.ps.env("HOME") ?? deps.ps.cwd(),
		);
		const name = await names.choose(used, opts.name, opts.out);
		const key = opts["no-mic"]
			? ""
			: ((await (await recCredentials()).get(KEY_NAME)) ?? "");
		const jobs = new Set<Promise<void>>();
		const store = new SessionStore(deps.fs, deps.log, `${home(deps)}/sessions`);
		let finishing = Promise.resolve();
		/** Folders still to transcribe and rank, by session name. */
		const pending = new Map<string, string>();
		const finish = async (dir: string) => {
			await names.remember(home(deps), dir);
			deps.log.info(`saved ${dir}; processing`);
			try {
				await transcribeSession(deps, dir, {
					key,
					names: opts.names,
					reuse: true,
				});
				deps.log.info(`wrote ${dir}/timeline.md`);
				await rankSession(deps, dir);
				await markProcessed(deps, dir);
			} catch (error) {
				deps.log.error(`${dir} was saved but not processed: ${error}`);
				await markProcessed(deps, dir, error);
			}
			if (!opts.out) {
				await store.prune(dir, new Set(pending.keys()));
			}
		};
		const enqueue = (dir: string, sessionName: string) => {
			pending.set(dir, sessionName);
			const job = finishing
				.then(() => finish(dir))
				.catch((error: unknown) => {
					deps.log.error(`could not finish session ${dir}: ${error}`);
				})
				.finally(() => {
					jobs.delete(job);
					pending.delete(dir);
				});
			finishing = job;
			jobs.add(job);
		};
		// An earlier rec that was killed before it finished leaves its sessions for this one; one still running finishes its own.
		const earlier = (await client(deps).status()).running
			? []
			: await library(deps).unprocessed();
		for (const left of earlier) {
			deps.log.info(
				`finishing ${left.name}, which an earlier rec saved but did not process`,
			);
			enqueue(left.dir, left.name);
		}
		const interrupted = new AbortController();
		const sigint = Promise.withResolvers<void>();
		const forced = Promise.withResolvers<"forced">();
		// A killed or hung-up rec must close its Chrome too, or the orphan holds the profile and the next start finds no DevTools port.
		// The first signal stops and finishes what is pending; a second quits at once, leaving it for the next start.
		const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((name) =>
			deps.ps.on(name, () => {
				if (interrupted.signal.aborted) {
					forced.resolve("forced");
					return;
				}
				interrupted.abort();
				sigint.resolve();
			}),
		);
		const signal = {
			dispose: () => {
				for (const handler of handlers) {
					handler.dispose();
				}
			},
		};
		const session = await openSession(
			deps,
			{ next: () => freshDir(deps, opts.out) },
			() => opts.url,
			{
				signal: interrupted.signal,
				fakeMedia: false,
				name,
				usedNames: used,
				docker: opts.docker,
				tails: opts.tail,
				staged: true,
				noMic: opts["no-mic"],
				liveKey: key === "" ? undefined : key,
				fps: opts.fps,
				processing: () => [...pending.values()],
			},
		).catch((error: unknown) => {
			signal.dispose();
			if (interrupted.signal.aborted) {
				deps.log.info("interrupted while opening; closed Chrome");
				return undefined;
			}
			throw error;
		});
		if (!session) {
			return;
		}
		const { chrome, server } = session;
		server.events.on("saved", ({ dir, manifest }) => {
			enqueue(dir, manifest.name ?? dir.split("/").pop() ?? dir);
		});
		try {
			deps.log.info(
				"staged: press Start in the control window to record, as many times as you like; press Ctrl-C, or Stop on the splates rec page, to finish",
			);
			const ended = await Promise.race([
				sigint.promise.then(() => "interrupted" as const),
				server.closed.then(() => "closed" as const),
				chrome.exited.then(() => "quit" as const),
			]);
			if (ended !== "interrupted") {
				if (server.recordingNow) {
					deps.log.info(
						`${ended === "quit" ? "Chrome quit" : "The control panel closed"} while recording; saving the session`,
					);
					await server.salvage();
				}
				// rec stays up so its sessions finish; whoever started it ends it.
				deps.log.info(
					`${ended === "quit" ? "Chrome quit" : "The control panel closed"}; rec keeps running until Ctrl-C, or Stop on the splates rec page`,
				);
				await sigint.promise;
			}
			const how = await Promise.race([
				server
					.interrupt()
					.then(() => {
						if (pending.size > 0) {
							deps.log.info(
								`finishing ${[...pending.values()].join(", ")} before rec ends; press Ctrl-C again to quit now and finish them on the next start`,
							);
						}
						return Promise.all(jobs);
					})
					.then(() => "done" as const),
				forced.promise,
			]);
			if (how === "forced") {
				deps.log.info(
					`quit before finishing ${[...pending.values()].join(", ") || "the recording"}; the next rec start finishes what was saved`,
				);
			}
		} finally {
			signal.dispose();
			await chrome.close();
			server.dispose();
			await deps.fs.rm(serverFile(home(deps)), { force: true });
		}
		if (pending.size > 0) {
			deps.ps.exit(130);
		}
	});

rec
	.command("suggest-name")
	.description("print an unused session name for a name field or dice button")
	.action(async (_opts, deps) => {
		// vet-ignore classes-over-function-exports: shared filesystem service owns scanning and selection for both CLI commands
		const names = new SessionNames(deps.fs);
		const used = await names.available(
			home(deps),
			deps.ps.env("HOME") ?? deps.ps.cwd(),
		);
		deps.log.info(suggestName(used));
	});

rec
	.command("mark")
	.description(
		"add a text remark to the recording in progress, at this moment, as a person narrates with the mic",
	)
	.arg("text", z.string())
	.action(async (opts, deps) => {
		await client(deps).mark(opts.text);
		deps.log.info("marked");
	});

interface TranscribeSessionOptions {
	/** The OpenAI key; empty skips whisper and says how to retry. */
	key: string;
	/** Comma-separated project names for the transcript's prompt. */
	names: string;
	/** Keep a `transcript.json` already written instead of paying for whisper again. */
	reuse?: boolean;
}

/** Transcribes a session folder's recording and records the files in its manifest. */
async function transcribeSession(
	deps: RecDeps,
	dir: string,
	opts: TranscribeSessionOptions,
): Promise<void> {
	const { key, names, reuse = false } = opts;
	const manifestPath = `${dir}/manifest.json`;
	const manifest = JSON.parse(await deps.fs.read(manifestPath)) as Manifest;
	await transcribe({
		ps: deps.ps,
		fs: deps.fs,
		dir,
		recording: `${dir}/${manifest.files.recording}`,
		startedAt: manifest.startedAt,
		micOff: manifest.micOff,
		noMic: manifest.noMic,
		key,
		reuse,
		names: [
			deps.ps.cwd().split("/").pop() ?? "",
			...names
				.split(",")
				.map((name) => name.trim())
				.filter(Boolean),
		],
	});
	if (!manifest.micOff && !manifest.noMic && key) {
		manifest.files.transcript = "transcript.json";
	}
	if (!manifest.micOff && !manifest.noMic && !key) {
		manifest.transcription = {
			status: "skipped",
			reason: "OPENAI_API_KEY is not set; audio is saved in the recording",
			retry: `rec transcribe ${JSON.stringify(dir)}`,
		};
		deps.log.info(
			`No transcript: ${manifest.transcription.reason}; set OPENAI_API_KEY, then run ${manifest.transcription.retry}`,
		);
	} else {
		delete manifest.transcription;
	}
	manifest.files.timeline = "timeline.md";
	manifest.files.momentsReport = "moments.md";
	await deps.fs.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Records in the manifest that the session's transcript and moments are done, or why they failed. */
async function markProcessed(
	deps: RecDeps,
	dir: string,
	error?: unknown,
): Promise<void> {
	const manifestPath = `${dir}/manifest.json`;
	const manifest = JSON.parse(await deps.fs.read(manifestPath)) as Manifest;
	if (error === undefined) {
		delete manifest.processing;
	} else {
		manifest.processing = {
			status: "failed",
			reason: error instanceof Error ? error.message : String(error),
			retry: `rec transcribe ${JSON.stringify(dir)}`,
		};
	}
	await deps.fs.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Judges and ranks a session's moments into `moments.md`, with Jev when a TypeSafe key is set. */
async function rankSession(
	deps: RecDeps,
	dir: string,
	about?: string,
): Promise<void> {
	const key = await optionalJevKey();
	const result = await writeMoments({
		fs: deps.fs,
		dir,
		jev: key ? new Jev(key) : undefined,
		about,
	});
	deps.log.info(
		`${result.moments.length} moments in ${dir}/moments.md${key ? "" : " (code signals only: no TYPESAFE_API_KEY)"}`,
	);
}

rec
	.command("moments")
	.description(
		"judge and rank a session folder's moments into moments.md; --about re-ranks them against a prompt",
	)
	.arg("dir", z.string())
	.option("about", z.string().optional(), {
		description:
			"what to rank the moments against, such as 'the checkout form'",
	})
	.action(async (opts, deps) => {
		await rankSession(deps, opts.dir, opts.about);
	});

rec
	.command("slice")
	.description(
		"cut screenshots and a silent clip around a moment of a session, with padding, into its slices/ folder",
	)
	.arg("name", z.string())
	.option("at", z.string().optional(), {
		description: "the moment, in video time: seconds or m:ss",
	})
	.option("moment", z.coerce.number().int().optional(), {
		description: "a ranked moment from moments.md, instead of --at",
	})
	.option("before", z.coerce.number().default(5), {
		description: "seconds of padding before",
	})
	.option("after", z.coerce.number().default(5), {
		description: "seconds of padding after",
	})
	.option("json", z.boolean().default(false), {
		description: "print JSON: { folder, from, to, at, clip, shots }",
	})
	.action(async (opts, deps) => {
		const dir = await library(deps)
			.path(opts.name)
			.catch(async (cause) => {
				if (await deps.fs.exists(`${opts.name}/manifest.json`)) {
					return opts.name;
				}
				throw cause;
			});
		const result = await sliceSession({
			fs: deps.fs,
			ps: deps.ps,
			dir,
			at: opts.at === undefined ? undefined : parseVideoTime(opts.at),
			moment: opts.moment,
			before: opts.before,
			after: opts.after,
		});
		if (opts.json) {
			deps.log.info(JSON.stringify(result));
			return;
		}
		deps.log.info(
			`${result.from.toFixed(1)}s-${result.to.toFixed(1)}s (moment at ${result.at.toFixed(1)}s)\nclip: ${result.clip}\n${result.shots.map((shot) => `shot: ${shot}`).join("\n")}`,
		);
	});

rec
	.command("sources")
	.description(
		"list the Chrome tabs and Docker containers rec could follow; tabs only while rec's Chrome is open",
	)
	.option("json", z.boolean().default(false), {
		description: "print JSON: { tabs: [{ title, url }], containers, error? }",
	})
	.action(async (opts, deps) => {
		const portFile = `${home(deps)}/chrome/DevToolsActivePort`;
		const url = (await deps.fs.exists(portFile))
			? parseActivePort(await deps.fs.read(portFile))
			: undefined;
		let tabs: { title: string; url: string }[] = [];
		if (url) {
			try {
				const cdp = await CdpSocket.open(url);
				const { targetInfos } = await cdp.send<{
					targetInfos: { type: string; title: string; url: string }[];
				}>("Target.getTargets");
				cdp.dispose();
				tabs = targetInfos
					.filter((info) => info.type === "page")
					.map((info) => ({ title: info.title, url: info.url }));
			} catch {
				// Chrome is not running; the file is left over.
			}
		}
		let containers: Awaited<ReturnType<typeof listContainers>> = [];
		let error: string | undefined;
		try {
			containers = await listContainers(deps.ps);
		} catch (cause) {
			error = (cause as Error).message;
		}
		if (opts.json) {
			deps.log.info(
				JSON.stringify({ tabs, containers, ...(error ? { error } : {}) }),
			);
			return;
		}
		const out: string[] = ["tabs:"];
		out.push(
			...(tabs.length > 0
				? tabs.map((tab) => `  ${tab.title || "(untitled)"}  ${tab.url}`)
				: ["  none: rec's Chrome is not open"]),
		);
		out.push("containers:");
		out.push(
			...(error
				? [`  ${error}`]
				: containers.length > 0
					? containers.map(
							(box) =>
								`  ${box.name}  ${box.id}${box.project ? `  (compose: ${box.project})` : ""}`,
						)
					: ["  none running"]),
		);
		deps.log.info(out.join("\n"));
	});

rec
	.command("status")
	.description(
		"say whether rec is running, the session's name and whether it is recording",
	)
	.option("json", z.boolean().default(false), {
		description:
			"print JSON: { running, name?, recording?, startedAt?, mic?, laser?, lastOutcome?, processing? }",
	})
	.action(async (opts, deps) => {
		const status = await client(deps).status();
		deps.log.info(
			opts.json
				? JSON.stringify(status)
				: !status.running
					? "rec is not running"
					: `rec is running: ${status.name}, ${status.recording ? "recording" : "not recording"}`,
		);
	});

const sessions = rec.group("sessions");

function client(deps: RecDeps): RecClient {
	return new RecClient(deps.fs, home(deps));
}

function library(deps: RecDeps): SessionLibrary {
	return new SessionLibrary(deps.fs, `${home(deps)}/sessions`, home(deps));
}

sessions
	.command("list")
	.description(
		"list saved sessions, newest first, with the store's total size and limit",
	)
	.option("json", z.boolean().default(false), {
		description:
			"print JSON: { sessions: [{ name, folder, startedAt, length, size, moments, topSaid? }], totalSize, limit }",
	})
	.action(async (opts, deps) => {
		const list = await library(deps).list();
		deps.log.info(
			opts.json
				? JSON.stringify(list)
				: [
						...list.sessions.map(
							(item) =>
								`${item.name}  ${item.length.toFixed(0)}s  ${item.size} bytes  ${item.moments} moments${item.topSaid ? `  "${item.topSaid}"` : ""}`,
						),
						`${list.totalSize} of ${list.limit} bytes`,
					].join("\n"),
		);
	});

sessions
	.command("show")
	.description(
		"print a session's summary, moments, timeline, stills and log files",
	)
	.arg("name", z.string())
	.action(async (opts, deps) => {
		deps.log.info(JSON.stringify(await library(deps).show(opts.name)));
	});

sessions
	.command("path")
	.description("print a session's folder, for an agent to read")
	.arg("name", z.string())
	.action(async (opts, deps) => {
		deps.log.info(await library(deps).path(opts.name));
	});

sessions
	.command("rename")
	.description("give a session a new name; its folder stays")
	.arg("old", z.string())
	.arg("new", z.string())
	.action(async (opts, deps) => {
		await library(deps).rename(opts.old, opts.new);
		deps.log.info(`renamed ${opts.old} to ${opts.new}`);
	});

sessions
	.command("delete")
	.description("delete a saved session and its folder")
	.arg("name", z.string())
	.action(async (opts, deps) => {
		await library(deps).delete(opts.name);
		deps.log.info(`deleted ${opts.name}`);
	});

sessions
	.command("search")
	.description("find sessions by name or by what was said")
	.arg("query", z.string())
	.option("json", z.boolean().default(false), {
		description: "print JSON: [{ name, in, snippet }]",
	})
	.action(async (opts, deps) => {
		const found = await library(deps).search(opts.query);
		deps.log.info(
			opts.json
				? JSON.stringify(found)
				: found
						.map((item) => `${item.name}  (${item.in}) ${item.snippet}`)
						.join("\n"),
		);
	});

rec
	.group("skills")
	.command("add")
	.description(
		"copy the rec skill into this folder's .claude/skills and .agents/skills; --global installs under your home folder instead",
	)
	.option("global", z.boolean().default(false), {
		description: "install under ~/.claude and ~/.agents",
	})
	.option("force", z.boolean().default(false), {
		description: "overwrite installed files that were edited by hand",
	})
	.action(async (opts, deps) => {
		const root = opts.global
			? (deps.ps.env("HOME") ?? deps.ps.cwd())
			: deps.ps.cwd();
		const result = await installSkill(
			deps.fs,
			await deps.fs.read(BUNDLED_SKILL),
			root,
			{ force: opts.force },
		);
		if (!result.ok) {
			throw new Error(result.reason);
		}
		deps.log.info(
			["wrote", ...result.written.map((file) => `  ${file}`)].join("\n"),
		);
	});

rec
	.command("transcribe")
	.description(
		"transcribe a session folder's recording again, such as after a failure",
	)
	.arg("dir", z.string())
	.option("names", z.string().default(""), {
		description: "comma-separated project names for the transcript's prompt",
	})
	.option("reuse", z.boolean().default(false), {
		description:
			"keep the folder's transcript.json instead of paying for whisper again",
	})
	.action(async (opts, deps) => {
		const key = await requireKey(await recCredentials());
		await transcribeSession(deps, opts.dir, {
			key,
			names: opts.names,
			reuse: opts.reuse,
		});
		deps.log.info(`transcribed ${opts.dir}/timeline.md`);
		await rankSession(deps, opts.dir);
		await markProcessed(deps, opts.dir);
	});

rec
	.command("bench")
	.description(
		"record a scripted session of scrolling, animation and video, and measure the recording: frames, CPU and drift",
	)
	.option("minutes", z.coerce.number().positive(), { default: 10 })
	.option("fps", z.coerce.number().positive(), {
		default: DEFAULT_MAX_FPS,
		description:
			"the most frames per second sent to the control window; a large number such as 1000 leaves it uncapped",
	})
	.option("baseline", z.boolean().default(false), {
		description:
			"browse the same page with nothing recording it and report only CPU, so a normal run's cost over it is the recording's own",
	})
	.option("out", z.string().optional(), {
		description: SESSION_STORE_POLICY,
	})
	.action(async (opts, deps) => {
		const video = await benchVideo(deps, home(deps));
		const store = new SessionStore(deps.fs, deps.log, `${home(deps)}/sessions`);
		const dir = sessionDir(deps, opts.out);
		const { chrome, server } = await openSession(
			deps,
			dir,
			(server) => `${server.origin}/bench`,
			{
				fakeMedia: true,
				fps: opts.fps,
				staged: opts.baseline,
				noScreencast: opts.baseline,
				routes: {
					"/bench": new Response(BENCH_PAGE, {
						headers: { "content-type": "text/html" },
					}),
					"/bench/video.mp4": new Response(video, {
						headers: { "content-type": "video/mp4" },
					}),
				},
			},
		);
		try {
			const cdp = chrome.cdp;
			const driver = new BenchDriver(cdp);
			if (!opts.baseline) {
				await server.recording;
			}
			const working = await driver.attach("page", (url) =>
				url.endsWith("/bench"),
			);
			// The control page is framed in Chrome's side panel, so it is an iframe target.
			const controlWindow = await driver.attach("iframe", (url) =>
				url.startsWith(server.controlUrl),
			);
			await cdp.send("Performance.enable", {}, controlWindow);
			const before = await driver.sampleCpu(controlWindow, deps.wall);
			deps.log.info(`benching for ${opts.minutes} minutes`);
			await driver.scroll(working, Duration.mins(opts.minutes));
			const after = await driver.sampleCpu(controlWindow, deps.wall);
			if (opts.baseline) {
				const report = summarizeCpu(before, after);
				await deps.fs.mkdir(dir, { recursive: true });
				await deps.fs.write(
					`${dir}/bench-baseline.json`,
					`${JSON.stringify(report, null, 2)}\n`,
				);
				deps.log.info(JSON.stringify(report, null, 2));
				deps.log.info(`saved ${dir}`);
				if (!opts.out) {
					await store.prune(dir);
				}
				return;
			}
			const manifest = await server.stop();
			const recording = server.session.recording;
			const report = summarize(
				manifest,
				await probe(deps, recording),
				(await deps.fs.stat(recording)).size,
				before,
				after,
			);
			await deps.fs.write(
				`${dir}/bench.json`,
				`${JSON.stringify(report, null, 2)}\n`,
			);
			deps.log.info(JSON.stringify(report, null, 2));
			deps.log.info(`saved ${dir}`);
			if (!opts.out) {
				await store.prune(dir);
			}
		} finally {
			chrome.dispose();
			server.dispose();
		}
	});
