import { brotliCompress } from "node:zlib";
import type { Assets } from "./assets";

type Body = string | Uint8Array<ArrayBuffer>;

/** One file the page asks for, hashed once as it is loaded. */
interface PageFile {
	body: Body;
	type: string;
	hash: string;
	/**
	 * Whether its name already holds its hash, so any request for it may keep
	 * it for good, not only one stamped with a `?v=`.
	 */
	named: boolean;
}

/**
 * The page the server hands to browsers: the files built as this run
 * started. It changes only with a restart, which builds it again before the
 * server comes back, so the page always matches the server it talks to.
 */
export class Pages {
	/** The shell, naming the script and styles by what they hold. */
	readonly page: string;

	/**
	 * Each file by its path: the small ones made as the server starts, the
	 * chunks and their maps only on the first ask for one.
	 */
	private readonly files = new Map<
		string,
		() => PageFile | Promise<PageFile>
	>();

	constructor(readonly assets: Assets) {
		const made = (body: Body, type: string, named: boolean): PageFile => ({
			body,
			type,
			hash: Bun.hash(body).toString(36),
			named,
		});
		const file = (path: string, body: Body, type: string): PageFile => {
			const ready = made(body, type, false);
			this.files.set(path, () => ready);
			return ready;
		};
		const later = (path: string, load: () => Promise<Body>, type: string) => {
			let ready: Promise<PageFile> | null = null;
			// Each named by its content's hash, so no `?v=` is needed to keep one.
			this.files.set(path, () => {
				ready ??= load().then((body) => made(body, type, true));
				return ready;
			});
		};
		const js = "text/javascript; charset=utf-8";
		const script = file("/main.js", assets.script, js);
		file("/main.js.map", assets.scriptMap, "application/json");
		const styles = file(
			"/styles.css",
			assets.styles,
			"text/css; charset=utf-8",
		);
		// At the root, so its scope is the whole page.
		file("/worker.js", assets.worker, js);
		file("/worker.js.map", assets.workerMap, "application/json");
		file(
			"/manifest.webmanifest",
			assets.manifest,
			"application/manifest+json; charset=utf-8",
		);
		file("/icon-192.png", assets.icons[192], "image/png");
		file("/icon-512.png", assets.icons[512], "image/png");
		// The chunks the script loads as a page is first opened.
		const { chunks } = assets;
		for (const name of chunks.names) {
			later(`/${name}`, async () => (await chunks.code())[name] ?? "", js);
			later(
				`/${name}.map`,
				async () => (await chunks.maps())[name] ?? "",
				"application/json",
			);
		}
		this.page = stamped(assets, { script: script.hash, styles: styles.hash });
		file("/", this.page, "text/html; charset=utf-8");
	}

	/** The server's routes for the page's own files, spread into its `routes`. */
	routes(): Record<string, (request: Request) => Promise<Response>> {
		// The page is a React app in `packages/web`, built before publishing and
		// carried in the bundle, so nothing here builds markup or reads it off
		// disk.
		return Object.fromEntries(
			[...this.files].map(([path, file]) => [
				path,
				async (request: Request) => this.respond(request, await file()),
			]),
		);
	}

	/** What each body gzips to, made on first ask and kept for the run. */
	private readonly gzipped = new Map<string, Uint8Array<ArrayBuffer>>();

	/**
	 * What each body compresses to under brotli, which takes seconds at its
	 * best setting: started on the first ask and kept once done, while that
	 * ask and any before it is done are answered with gzip.
	 */
	private readonly brotlied = new Map<
		string,
		Uint8Array<ArrayBuffer> | "making"
	>();

	/**
	 * `file`, or a 304 for a request that holds this very build. A request for
	 * the stamped `?v=` name of a body it holds may keep it for good, since a
	 * new build is a new name.
	 */
	private respond(request: Request, file: PageFile): Response {
		// Answered by hand, since a route that reads what is served on each
		// request gets no ETag from Bun.
		const { body, type, hash } = file;
		const etag = `"${hash}"`;
		const stamp = new URL(request.url).searchParams.get("v");
		const headers = {
			etag,
			// Ask again each time, so a restart's build reaches the page. The
			// ETag makes asking cheap. Without it, Cloudflare keeps the .js,
			// .css and .png at its edge, and has a phone keep them too, for
			// hours after the server moved on. Only the name stamped with the
			// body's own hash is safe to keep.
			"cache-control":
				file.named || stamp === hash
					? "public, max-age=31536000, immutable"
					: "no-cache",
			vary: "accept-encoding",
		};
		if (request.headers.get("if-none-match") === etag) {
			return new Response(null, { status: 304, headers });
		}
		const accepts = request.headers.get("accept-encoding") ?? "";
		if (typeof body !== "string" || body.length <= 1024) {
			return new Response(body, {
				headers: { ...headers, "content-type": type },
			});
		}
		const brotli = /\bbr\b/.test(accepts) ? this.brotli(file) : null;
		if (brotli !== null) {
			return new Response(brotli, {
				headers: {
					...headers,
					"content-type": type,
					"content-encoding": "br",
				},
			});
		}
		if (!/\bgzip\b/.test(accepts)) {
			return new Response(body, {
				headers: { ...headers, "content-type": type },
			});
		}
		let packed = this.gzipped.get(hash);
		if (!packed) {
			packed = Bun.gzipSync(body, { level: 9 });
			this.gzipped.set(hash, packed);
		}
		return new Response(packed, {
			headers: { ...headers, "content-type": type, "content-encoding": "gzip" },
		});
	}

	/** `file` under brotli once that is made, else null, starting to make it. */
	private brotli({ body, hash }: PageFile): Uint8Array<ArrayBuffer> | null {
		const made = this.brotlied.get(hash);
		if (made !== undefined) {
			return made === "making" ? null : made;
		}
		this.brotlied.set(hash, "making");
		brotliCompress(body, (error, packed) => {
			if (error === null) {
				this.brotlied.set(hash, new Uint8Array(packed));
			} else {
				this.brotlied.delete(hash);
			}
		});
		return null;
	}
}

// The shell names its script and styles by what they hold, so no cache on the
// way, Cloudflare's edge or a phone's, hands back a build from before a
// restart under the name a new one goes by. It also asks for the chunks the
// script starts from, so they load beside it rather than after it.
function stamped(
	{ shell, script }: Assets,
	hashes: { script: string; styles: string },
): string {
	const starts = [
		...script.matchAll(/(?:from|import\()"\.\/(chunk-\w+\.js)"/g),
	].map((match) => match[1]);
	const preloads = [...new Set(starts)]
		.map((name) => `<link rel="modulepreload" href="/${name}">`)
		.join("\n\t\t");
	return shell
		.replace('src="/main.js"', `src="/main.js?v=${hashes.script}"`)
		.replace('href="/styles.css"', `href="/styles.css?v=${hashes.styles}"`)
		.replace("</head>", `${preloads}\n\t</head>`);
}
