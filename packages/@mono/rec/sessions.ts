import type { Fs } from "core/system";
import type { Moment } from "./moment-types";
import { parseMomentsFile } from "./moments-files";
import type { Manifest } from "./session";
import { SessionNames, sessionName } from "./session-name";
import { SESSION_STORE_LIMIT, type SessionStoreOptions } from "./session-store";
import { MOMENTS_JSONL } from "./signals";
import type { Transcript } from "./timeline";

/** What `rec sessions list` says of one session. */
export interface SessionSummary {
	name: string;
	folder: string;
	startedAt: number;
	/** Seconds of recording. */
	length: number;
	/** Bytes on disk. */
	size: number;
	moments: number;
	/** What was said at the top-ranked moment, else the first thing said. */
	topSaid?: string;
}

/** `rec sessions show`: the summary with what an agent reads. */
export interface SessionDetail extends SessionSummary {
	momentList: Moment[];
	/** The timeline file, when the session has one. */
	timeline?: string;
	stills: string[];
	logs: string[];
}

export interface SessionMatch {
	name: string;
	/** Where the query was found: the name or a spoken line. */
	in: "name" | "said";
	snippet: string;
}

interface Entry {
	folder: string;
	manifest: Manifest;
}

/** Reads and manages the sessions in rec's store; nothing here touches a recording in progress. */
export class SessionLibrary {
	private readonly limit: number;

	constructor(
		private readonly fs: Fs,
		readonly root: string,
		private readonly home: string,
		opts: SessionStoreOptions = {},
	) {
		this.limit = opts.limit ?? SESSION_STORE_LIMIT;
	}

	private async entries(): Promise<Entry[]> {
		const out: Entry[] = [];
		for (const folder of await this.fs
			.readdir(this.root)
			.catch(() => [] as string[])) {
			try {
				const manifest = JSON.parse(
					await this.fs.read(`${this.root}/${folder}/manifest.json`),
				) as Manifest;
				if (Number.isFinite(manifest.startedAt)) {
					out.push({ folder, manifest });
				}
			} catch {
				// A recording in progress or a stray folder is not a session yet.
			}
		}
		return out.sort(
			(left, right) => right.manifest.startedAt - left.manifest.startedAt,
		);
	}

	private async find(name: string): Promise<Entry> {
		const entries = await this.entries();
		const found =
			entries.find((entry) => entry.manifest.name === name) ??
			entries.find((entry) => entry.folder === name);
		if (!found) {
			throw new Error(`No session named ${name}: see \`rec sessions list\``);
		}
		return found;
	}

	private async bytes(path: string): Promise<number> {
		if (await this.fs.isSymlink(path)) {
			return 0;
		}
		const stat = await this.fs.stat(path);
		if (!stat.isDirectory()) {
			return stat.size;
		}
		let size = 0;
		for (const entry of await this.fs.readdir(path)) {
			size += await this.bytes(`${path}/${entry}`);
		}
		return size;
	}

	private async moments(dir: string): Promise<Moment[]> {
		const text = await this.fs.read(`${dir}/${MOMENTS_JSONL}`).catch(() => "");
		return parseMomentsFile(text).moments.sort(
			(left, right) => left.rank - right.rank,
		);
	}

	private async transcript(dir: string): Promise<Transcript | undefined> {
		try {
			return JSON.parse(await this.fs.read(`${dir}/transcript.json`));
		} catch {
			return undefined;
		}
	}

	private async summarize(entry: Entry): Promise<SessionSummary> {
		const dir = `${this.root}/${entry.folder}`;
		const moments = await this.moments(dir);
		const first = (await this.transcript(dir))?.utterances[0]?.text;
		const topSaid = moments.find((moment) => moment.said)?.said ?? first;
		return {
			name: entry.manifest.name ?? entry.folder,
			folder: dir,
			startedAt: entry.manifest.startedAt,
			length: Math.max(
				0,
				(entry.manifest.stoppedAt - entry.manifest.startedAt) / 1000,
			),
			size: await this.bytes(dir),
			moments: moments.length,
			...(topSaid ? { topSaid } : {}),
		};
	}

	/** Sessions newest first, with the store's total size and limit. */
	async list(): Promise<{
		sessions: SessionSummary[];
		totalSize: number;
		limit: number;
	}> {
		const sessions = await Promise.all(
			(await this.entries()).map((entry) => this.summarize(entry)),
		);
		return {
			sessions,
			totalSize: sessions.reduce((sum, session) => sum + session.size, 0),
			limit: this.limit,
		};
	}

	async show(name: string): Promise<SessionDetail> {
		const entry = await this.find(name);
		const dir = `${this.root}/${entry.folder}`;
		const files = entry.manifest.files;
		const stills = (
			await this.fs
				.readdir(`${dir}/${files.frames ?? "frames"}`)
				.catch(() => [] as string[])
		)
			.sort()
			.map((still) => `${dir}/${files.frames ?? "frames"}/${still}`);
		const logs = Object.entries(files)
			.filter(
				([key, file]) =>
					key !== "frames" &&
					(file.startsWith("logs/") ||
						file.endsWith(".log") ||
						key === "console" ||
						key === "network"),
			)
			.map(([, file]) => `${dir}/${file}`);
		const momentList = await this.moments(dir);
		return {
			...(await this.summarize(entry)),
			momentList,
			...(files.timeline ? { timeline: `${dir}/${files.timeline}` } : {}),
			stills,
			logs,
		};
	}

	/** The session's folder, for an agent to read. */
	async path(name: string): Promise<string> {
		return `${this.root}/${(await this.find(name)).folder}`;
	}

	/** Gives a session a new display name; the folder stays. */
	async rename(from: string, to: string): Promise<void> {
		sessionName.parse(to);
		const entry = await this.find(from);
		const used = await new SessionNames(this.fs).available(
			this.home,
			this.home.replace(/\/\.rec$/, ""),
		);
		if (used.has(to)) {
			throw new Error(`Session name ${to} is already in use; choose another`);
		}
		entry.manifest.name = to;
		await this.fs.write(
			`${this.root}/${entry.folder}/manifest.json`,
			`${JSON.stringify(entry.manifest, null, 2)}\n`,
		);
	}

	/** Deletes a saved session; the one being recorded has no manifest and is not found. */
	async delete(name: string): Promise<void> {
		const entry = await this.find(name);
		await this.fs.rm(`${this.root}/${entry.folder}`, { recursive: true });
	}

	/** Sessions whose name or spoken lines hold the query, ignoring case. */
	async search(query: string): Promise<SessionMatch[]> {
		const needle = query.trim().toLowerCase();
		const out: SessionMatch[] = [];
		if (needle === "") {
			return out;
		}
		for (const entry of await this.entries()) {
			const name = entry.manifest.name ?? entry.folder;
			if (
				name.toLowerCase().includes(needle) ||
				entry.folder.toLowerCase().includes(needle)
			) {
				out.push({ name, in: "name", snippet: name });
				continue;
			}
			const dir = `${this.root}/${entry.folder}`;
			const said = (await this.transcript(dir))?.utterances.find((line) =>
				line.text.toLowerCase().includes(needle),
			);
			if (said) {
				out.push({ name, in: "said", snippet: said.text });
			}
		}
		return out;
	}
}
