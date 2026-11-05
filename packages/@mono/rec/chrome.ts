import { aborts } from "core/abort";
import type { Resource } from "core/disposable";
import type { Child, Fs, Ps } from "core/system";
import { Duration, sleep } from "core/time";
import { CdpSocket } from "./cdp";

export interface ChromeOptions {
	/** The folder of the profile to run on: rec's own, not the everyday one. */
	profile: string;
	/** What the working window opens on first: rec's `/__rec/open` page, which opens the side panel. */
	url: string;
	/**
	 * Chrome's fake camera and mic, with no permission prompts, for a run with
	 * nobody at the machine.
	 */
	fakeMedia?: boolean;
	/** Gives up launching, ending the Chrome it started. */
	signal?: AbortSignal;
}

/** Chrome running on the rec profile, with its DevTools socket open. */
export class Chrome implements Resource {
	private constructor(
		private readonly child: Child,
		readonly cdp: CdpSocket,
	) {}

	static async launch(ps: Ps, fs: Fs, options: ChromeOptions): Promise<Chrome> {
		const signal = options.signal ?? new AbortController().signal;
		await fs.mkdir(options.profile, { recursive: true });
		const portFile = `${options.profile}/DevToolsActivePort`;
		// A file left by the last run would point at a port nobody listens on.
		await fs.rm(portFile, { force: true });
		const child = ps.start([chromeBinary(ps), ...chromeArgs(options)]);
		// Unread output can fill the pipes and block Chrome, even during launch.
		for (const stream of [child.stdout, child.stderr]) {
			void stream.pipeTo(new WritableStream()).catch(() => {});
		}
		try {
			const url = await waitForPort(fs, portFile, child, signal);
			return new Chrome(child, await aborts.race(signal, CdpSocket.open(url)));
		} catch (error) {
			child.kill();
			throw error;
		}
	}

	/** Resolves when Chrome has quit, by the person or by `dispose`. */
	get exited(): Promise<unknown> {
		return Promise.race([this.child.exited, this.cdp.closed]);
	}

	dispose(): void {
		void this.cdp.send("Browser.close").catch(() => undefined);
		this.cdp.dispose();
		setTimeout(() => this.child.kill(), 2000).unref?.();
	}

	/** Quits Chrome and resolves once it is gone: use it when rec is about to exit, which `dispose` would not outlast. */
	async close(grace = Duration.secs(2)): Promise<void> {
		// A Chrome that does not answer has to be signalled.
		void this.cdp.send("Browser.close").catch(() => undefined);
		if (!(await this.quitWithin(grace))) {
			this.child.kill();
			if (!(await this.quitWithin(Duration.secs(1)))) {
				this.child.kill("SIGKILL");
			}
		}
		this.cdp.dispose();
	}

	private quitWithin(time: Duration): Promise<boolean> {
		return Promise.race([
			this.child.exited.then(() => true),
			sleep(time).then(() => false),
		]);
	}
}

async function waitForPort(
	fs: Fs,
	portFile: string,
	child: Child,
	signal: AbortSignal,
): Promise<string> {
	let quit = false;
	void child.exited.then(() => {
		quit = true;
	});
	for (let tries = 0; tries < 150; tries++) {
		signal.throwIfAborted();
		if (await fs.exists(portFile)) {
			const url = parseActivePort(await fs.read(portFile));
			if (url) {
				return url;
			}
		}
		if (quit) {
			throw new Error(
				"Chrome quit before opening its DevTools port: is the rec profile already open in another Chrome?",
			);
		}
		await sleep(Duration.ms(100));
	}
	throw new Error("Chrome did not open its DevTools port within 15 seconds");
}

const MAC_CHROME =
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Where the Chrome binary is: `REC_CHROME` when set, else where it installs. */
export function chromeBinary(ps: Ps): string {
	const set = ps.env("REC_CHROME");
	if (set) {
		return set;
	}
	return ps.platform === "darwin" ? MAC_CHROME : "google-chrome";
}

export function chromeArgs(options: ChromeOptions): string[] {
	return [
		`--user-data-dir=${options.profile}`,
		// Port 0 lets Chrome pick one, which it writes to DevToolsActivePort.
		"--remote-debugging-port=0",
		"--no-first-run",
		"--no-default-browser-check",
		"--autoplay-policy=no-user-gesture-required",
		// The control window keeps painting and recording when it is covered.
		"--disable-backgrounding-occluded-windows",
		// Lets `Extensions.loadUnpacked` load rec's side panel extension.
		"--enable-unsafe-extension-debugging",
		...(options.fakeMedia
			? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
			: []),
		"--new-window",
		options.url,
	];
}

/** The browser socket's URL from the `DevToolsActivePort` file: its port, then its path. */
export function parseActivePort(text: string): string | undefined {
	const [port, path] = text.trim().split("\n");
	if (!port || !path) {
		return undefined;
	}
	return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
}
