import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { Debouncer, Duration, SystemTimer } from "webappwiz/time";
import type { Assets } from "./dev/assets";

export type PagesEvents = { rebuilt: string };

/** What the page's name carries in the shell, which an open tab reads back. */
export const PAGE_META = "arbor-page";

/** How long edits under `dev/` settle before the page is built again. */
export const REBUILD_SETTLE = Duration.ms(300);

/**
 * The page the server hands to browsers: its files, and the version they make
 * together. Replacing them serves the new page from the next request, and
 * says `rebuilt` so open tabs can be told.
 */
export class Pages implements Eventful<PagesEvents> {
	private readonly dispatcher = new Dispatcher<PagesEvents>();
	readonly events = this.dispatcher.events;

	/** The shell, naming the script and styles by what they hold. */
	page = "";
	/** Names this build of the page; changes with the script or the styles. */
	version = "";

	constructor(public assets: Assets) {
		this.stamp();
	}

	/** Serves `assets` from now on, and tells the tabs that hold the old page. */
	replace(assets: Assets): void {
		const before = this.version;
		this.assets = assets;
		this.stamp();
		if (this.version !== before) {
			this.dispatcher.dispatch("rebuilt", this.version);
		}
	}

	/** `body` as `type`, or a 304 for a request that holds this very build. */
	respond(
		request: Request,
		body: string | Uint8Array<ArrayBuffer>,
		type: string,
	): Response {
		// Answered by hand, since a route that reads what is served on each
		// request gets no ETag from Bun.
		const etag = `"${Bun.hash(body).toString(36)}"`;
		const headers = {
			etag,
			// Ask again each time, so a restart's build reaches the page. The
			// ETag makes asking cheap. Without it, Cloudflare keeps the .js,
			// .css and .png at its edge, and has a phone keep them too, for
			// hours after the server moved on.
			"cache-control": "no-cache",
		};
		if (request.headers.get("if-none-match") === etag) {
			return new Response(null, { status: 304, headers });
		}
		return new Response(body, {
			headers: { ...headers, "content-type": type },
		});
	}

	// The shell names its script and styles by what they hold, so no cache on
	// the way, Cloudflare's edge or a phone's, hands back a build from before a
	// restart under the name a new one goes by.
	private stamp(): void {
		const hash = (body: string) => Bun.hash(body).toString(36);
		const { shell, script, styles } = this.assets;
		this.version = hash(hash(script) + hash(styles));
		this.page = shell
			.replace('src="/main.js"', `src="/main.js?v=${hash(script)}"`)
			.replace('href="/styles.css"', `href="/styles.css?v=${hash(styles)}"`)
			.replace(
				"</head>",
				`<meta name="${PAGE_META}" content="${this.version}" /></head>`,
			);
	}
}

/** The files `build.ts` writes under `dev/build`, read back as assets. */
async function builtAssets(fs: Fs, dir: string): Promise<Assets> {
	const text = (name: string) => fs.read(`${dir}/${name}.txt`);
	const icon = async (size: number) =>
		Uint8Array.fromBase64(await text(`icon-${size}`));
	return {
		shell: await text("shell"),
		script: await text("main"),
		scriptMap: await text("main.map"),
		styles: await text("styles"),
		worker: await text("worker"),
		workerMap: await text("worker.map"),
		manifest: await text("manifest"),
		icons: { 192: await icon(192), 512: await icon(512) },
	};
}

/**
 * Builds the page again whenever a file under `dev/` changes, and serves what
 * it built, so iterating on the page needs no restart. A build that fails
 * leaves the page as it was.
 */
export function rebuildOnChange(
	pages: Pages,
	deps: { fs: Fs; ps: Ps; log: Logger },
	root: string,
): Resource {
	const { fs, ps, log } = deps;
	const dev = `${root}/dev`;
	let building = false;
	let again = false;
	const build = async (): Promise<void> => {
		if (building) {
			again = true;
			return;
		}
		building = true;
		try {
			const [runtime = "bun"] = ps.self;
			const { exitCode, stderr } = await ps.spawnCapture(
				[runtime, "run", "build.ts"],
				{ cwd: root },
			);
			if (exitCode !== 0) {
				log.error(`arbor dev could not rebuild the page: ${stderr.trim()}`);
			} else {
				pages.replace(await builtAssets(fs, `${dev}/build`));
			}
		} catch (error) {
			log.error(`arbor dev could not rebuild the page: ${String(error)}`);
		} finally {
			building = false;
		}
		if (again) {
			again = false;
			await build();
		}
	};
	const settle = new Debouncer(new SystemTimer(), REBUILD_SETTLE);
	const watch = fs.watch(
		dev,
		(path) => {
			// Its own output, and tests, which are not part of the page.
			if (!/(^|\/)build\//.test(path) && !/\.test\.tsx?$/.test(path)) {
				settle.call(() => void build());
			}
		},
		{ recursive: true },
	);
	return {
		dispose: () => {
			settle.cancel();
			watch.dispose();
		},
	};
}
