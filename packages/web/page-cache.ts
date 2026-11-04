/** The message a window gets when the shell it was served from the cache is no longer the server's. */
export interface Stale {
	type: "splates:reload";
}

/** Supplies persistent page storage. Pass the service worker’s `caches` object. */
export interface PageCaches {
	open(name: string): Promise<{
		match(request: string): Promise<Response | undefined>;
		put(request: string, response: Response): Promise<void>;
		delete(request: string): Promise<boolean>;
		keys(): Promise<readonly { url: string }[]>;
	}>;
}

/** What `respond` gives back: the answer, and the work to finish after it. */
export interface Answer {
	response: Promise<Response>;
	after: Promise<unknown>;
}

const CACHE = "splates.page";
/** The cache's key for the shell, which the server serves the same at any `?project=`. */
const SHELL = "/";

/**
 * Serves the current page online and the last saved page offline.
 * Call `respond` for each fetch event, then pass its response to `respondWith`
 * and its remaining work to `waitUntil`. API requests are left to the network.
 */
export class PageCache {
	constructor(
		private readonly caches: PageCaches,
		// Wrapped: a browser refuses its `fetch` called as another object's method.
		private readonly fetcher: (
			request: Request | string,
			init?: RequestInit,
		) => Promise<Response> = (request, init) => fetch(request, init),
	) {}

	/**
	 * How to answer `request`, or null to leave it to the network.
	 */
	respond(request: Request): Answer | null {
		if (request.method !== "GET") {
			return null;
		}
		const url = new URL(request.url);
		if (request.mode === "navigate" && url.pathname === SHELL) {
			return this.shell(request);
		}
		return named(url)
			? this.kept(request, `${url.pathname}${url.search}`)
			: null;
	}

	/** Read the shell afresh before choosing the bundle this navigation runs. */
	private shell(request: Request): Answer {
		const response = this.fetcher(
			new Request(request, { cache: "no-cache" }),
		).then(
			async (fresh) => {
				await this.replace(fresh.clone());
				return fresh;
			},
			async (error: unknown) => {
				const cached = await this.cache().then((cache) => cache.match(SHELL));
				if (cached === undefined) {
					throw error;
				}
				return cached;
			},
		);
		return { response, after: response };
	}

	/** Keeps `fresh`, dropping an old shell's files; whether the shell moved on. */
	private async replace(fresh: Response): Promise<boolean> {
		const cache = await this.cache();
		if (!fresh.ok || fresh.type === "opaqueredirect" || fresh.redirected) {
			await cache.delete(SHELL);
			return true;
		}
		const cached = await cache.match(SHELL);
		if (
			cached !== undefined &&
			(await fresh.clone().text()) === (await cached.text())
		) {
			return false;
		}
		for (const each of await cache.keys()) {
			await cache.delete(each.url);
		}
		await cache.put(SHELL, fresh);
		return true;
	}

	/** A file named by what it holds, from the cache, or the network kept for next time. */
	private kept(request: Request, key: string): Answer {
		const response = this.cache()
			.then((cache) => cache.match(key))
			.then(
				(cached) =>
					cached ??
					this.fetcher(request).then((fresh) => {
						this.keep(key, fresh);
						return fresh;
					}),
			);
		return { response, after: response };
	}

	/** Keeps a copy of `response` under `key`, when it is one to keep. */
	private keep(key: string, response: Response): void {
		if (!response.ok || response.redirected) {
			return;
		}
		const copy = response.clone();
		void this.cache()
			.then((cache) => cache.put(key, copy))
			.catch(() => {});
	}

	private cache() {
		return this.caches.open(CACHE);
	}
}

/** Whether `url` names a file by what it holds: the shell's stamped ones, and the chunks. */
function named(url: URL): boolean {
	return (
		(url.searchParams.has("v") &&
			(url.pathname === "/main.js" || url.pathname === "/styles.css")) ||
		/^\/chunk-\w+\.js$/.test(url.pathname)
	);
}
