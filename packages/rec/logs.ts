import { Disposer, type Resource } from "core/disposable";
import type { Fs } from "core/system";
import type { Cdp, CdpEvent } from "./cdp";
import {
	consoleLine,
	type ExceptionDetails,
	exceptionLine,
	LEVELS,
	logLine,
	type RemoteObject,
} from "./log-lines";
import { NetworkSummary, redactUrl } from "./network";
import type { Scrubber } from "./scrub";
import { type LogEntries, NO_ENTRIES, type PageFilter } from "./sinks";

/** The two files a session's browser logs go to, under `logs/`. */
export const CONSOLE_LOG = "logs/console.log";
export const NETWORK_LOG = "logs/network.log";

interface TargetInfo {
	targetId: string;
	type: string;
	url: string;
}

/** What `BrowserLogs.start` needs. */
export interface LogsOptions {
	cdp: Cdp;
	fs: Fs;
	/** The session folder; logs go under `logs/` in it. */
	dir: string;
	scrubber: Scrubber;
	/** Pages whose URL it matches are not logged, such as the control window. */
	skip: PageFilter;
	/** Hears each scrubbed line and the file it goes to. */
	entries?: LogEntries;
}

/**
 * The console, exceptions and network of every page but the control window,
 * over the DevTools connection, scrubbed and appended to the session's logs.
 */
export class BrowserLogs implements Resource {
	private readonly disposer = new Disposer();
	private readonly attached = new Set<string>();
	private readonly networks = new Map<string, NetworkSummary>();
	private writing = Promise.resolve();
	counts = { console: 0, network: 0 };

	private constructor(
		private readonly cdp: Cdp,
		private readonly fs: Fs,
		private readonly dir: string,
		private readonly scrubber: Scrubber,
		private readonly skip: PageFilter,
		private readonly entries: LogEntries = NO_ENTRIES,
	) {
		this.disposer.use(cdp.on(this.receive));
	}

	static async start(opts: LogsOptions): Promise<BrowserLogs> {
		await opts.fs.mkdir(`${opts.dir}/logs`, { recursive: true });
		const logs = new BrowserLogs(
			opts.cdp,
			opts.fs,
			opts.dir,
			opts.scrubber,
			opts.skip,
			opts.entries,
		);
		await opts.cdp.send("Target.setDiscoverTargets", { discover: true });
		const { targetInfos } = await opts.cdp.send<{ targetInfos: TargetInfo[] }>(
			"Target.getTargets",
		);
		await Promise.all(targetInfos.map((info) => logs.attach(info)));
		return logs;
	}

	/** Resolves once every line seen so far is on disk. */
	flush(): Promise<void> {
		return this.writing;
	}

	dispose(): void {
		this.disposer.dispose();
	}

	private async attach(info: TargetInfo): Promise<void> {
		if (
			info.type !== "page" ||
			this.attached.has(info.targetId) ||
			this.skip.skips(info.url)
		) {
			return;
		}
		this.attached.add(info.targetId);
		try {
			const { sessionId } = await this.cdp.send<{ sessionId: string }>(
				"Target.attachToTarget",
				{ targetId: info.targetId, flatten: true },
			);
			this.networks.set(sessionId, new NetworkSummary());
			await Promise.all([
				this.cdp.send("Runtime.enable", {}, sessionId),
				this.cdp.send("Log.enable", {}, sessionId),
				this.cdp.send("Network.enable", {}, sessionId),
			]);
		} catch {
			// The tab closed while it was being attached.
			this.attached.delete(info.targetId);
		}
	}

	private readonly receive = (event: CdpEvent): void => {
		const { method, params, sessionId } = event;
		switch (method) {
			case "Target.targetCreated":
			case "Target.targetInfoChanged":
				void this.attach(params.targetInfo as TargetInfo);
				return;
			case "Runtime.consoleAPICalled":
				this.write(
					CONSOLE_LOG,
					"console",
					consoleLine(
						Number(params.timestamp),
						String(params.type),
						(params.args as RemoteObject[]) ?? [],
					),
				);
				return;
			case "Runtime.exceptionThrown": {
				const details = params.exceptionDetails as ExceptionDetails;
				this.write(
					CONSOLE_LOG,
					"console",
					exceptionLine(Number(params.timestamp), details),
				);
				return;
			}
			case "Log.entryAdded": {
				const entry = params.entry as {
					level: string;
					text: string;
					timestamp: number;
					url?: string;
				};
				this.write(
					CONSOLE_LOG,
					"console",
					logLine(
						entry.timestamp,
						LEVELS[entry.level] ?? entry.level,
						`${entry.text}${entry.url ? ` (${redactUrl(entry.url)})` : ""}`,
					),
				);
				return;
			}
		}
		if (method.startsWith("Network.")) {
			const line = this.networks.get(sessionId ?? "")?.receive(method, params);
			if (line) {
				this.write(NETWORK_LOG, "network", line);
			}
		}
	};

	private write(file: string, kind: "console" | "network", line: string): void {
		this.counts[kind]++;
		const clean = this.scrubber.scrub(line);
		this.entries.entry(file, clean);
		this.writing = this.writing
			.then(() => this.fs.append(`${this.dir}/${file}`, `${clean}\n`))
			.catch(() => undefined);
	}
}
