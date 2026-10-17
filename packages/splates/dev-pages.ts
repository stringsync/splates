import type { Assets } from "./dev/assets";

/**
 * The page the server hands to browsers: the files built as this run
 * started. It changes only with a restart, which builds it again before the
 * server comes back, so the page always matches the server it talks to.
 */
export class Pages {
	/** The shell, naming the script and styles by what they hold. */
	readonly page: string;

	constructor(readonly assets: Assets) {
		this.page = stamped(assets);
	}

	/** The server's routes for the page's own files, spread into its `routes`. */
	routes(): Record<string, (request: Request) => Response> {
		// The page is a React app under `dev/`, built before publishing and
		// carried in the bundle, so nothing here builds markup or reads it off
		// disk.
		const asset =
			(body: () => string | Uint8Array<ArrayBuffer>, type: string) =>
			(request: Request): Response =>
				this.respond(request, body(), type);
		return {
			"/": asset(() => this.page, "text/html; charset=utf-8"),
			"/main.js": asset(
				() => this.assets.script,
				"text/javascript; charset=utf-8",
			),
			"/main.js.map": asset(() => this.assets.scriptMap, "application/json"),
			"/styles.css": asset(() => this.assets.styles, "text/css; charset=utf-8"),
			// At the root, so its scope is the whole page.
			"/worker.js": asset(
				() => this.assets.worker,
				"text/javascript; charset=utf-8",
			),
			"/worker.js.map": asset(() => this.assets.workerMap, "application/json"),
			"/manifest.webmanifest": asset(
				() => this.assets.manifest,
				"application/manifest+json; charset=utf-8",
			),
			"/icon-192.png": asset(() => this.assets.icons[192], "image/png"),
			"/icon-512.png": asset(() => this.assets.icons[512], "image/png"),
		};
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
}

// The shell names its script and styles by what they hold, so no cache on the
// way, Cloudflare's edge or a phone's, hands back a build from before a
// restart under the name a new one goes by.
function stamped({ shell, script, styles }: Assets): string {
	const hash = (body: string) => Bun.hash(body).toString(36);
	return shell
		.replace('src="/main.js"', `src="/main.js?v=${hash(script)}"`)
		.replace('href="/styles.css"', `href="/styles.css?v=${hash(styles)}"`);
}
