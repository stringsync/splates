/** The message a window gets when the shell it was served from the cache is no longer the server's. */
export interface Stale {
	type: "splates:reload";
}

/** The little of the worker's `caches` this uses. */
export interface PageCaches {
	open(name: string): Promise<{
		match(request: string): Promise<Response | undefined>;
		put(request: string, response: Response): Promise<void>;
		delete(request: string): Promise<boolean>;
		keys(): Promise<readonly { url: string }[]>;
	}>;
}

/** A window the worker can tell its shell went stale. */
export interface StaleWindows {
	get(id: string): Promise<{ postMessage(message: Stale): void } | undefined>;
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
 * The page's own files, kept in the service worker so a page opened again,
 * on a phone above all, draws without waiting on the network: the shell at
 * once, checked behind it, and the files named by what they hold for good.
 * Nothing under `/api` or any other address is kept.
 *
 * A shell served from the cache can be one from before a restart, which the
 * page's script would not match: once the server's is found to differ, it is
 * kept in its place, the files the old one named are dropped, and the window
 * it was served to is told to reload. A shell the server refuses, as
 * Cloudflare Access does when sign-in runs out, is dropped, so the reload
 * goes to the network and the sign-in.
 */
export class PageCache {
	constructor(
		private readonly caches: PageCaches,
		private readonly windows: StaleWindows,
		// Wrapped: a browser refuses its `fetch` called as another object's method.
		private readonly fetcher: (
			request: Request | string,
			init?: RequestInit,
		) => Promise<Response> = (request, init) => fetch(request, init),
	) {}

	/**
	 * How to answer `request`, made for the window `client` (a navigation's
	 * `resultingClientId`), or null to leave it to the network.
	 */
	respond(request: Request, client: string): Answer | null {
		if (request.method !== "GET") {
			return null;
		}
		const url = new URL(request.url);
		if (request.mode === "navigate" && url.pathname === SHELL) {
			return this.shell(request, client);
		}
		return named(url)
			? this.kept(request, `${url.pathname}${url.search}`)
			: null;
	}

	/** The shell from the cache, checked behind, or from the network when none is kept. */
	private shell(request: Request, client: string): Answer {
		// Two of it, one to serve and one to check against, as a body reads once.
		const kept = this.cache()
			.then((cache) => cache.match(SHELL))
			.then((cached) => cached && { served: cached, read: cached.clone() });
		const response = kept.then(
			(cached) =>
				cached?.served ??
				this.fetcher(request).then((fresh) => {
					this.keep(SHELL, fresh);
					return fresh;
				}),
		);
		const after = kept.then((cached) =>
			cached === undefined ? undefined : this.check(cached.read, client),
		);
		return { response, after };
	}

	/** Reads the shell afresh and, when it moved on from `cached`, tells `client`. */
	private async check(cached: Response, client: string): Promise<void> {
		const fresh = await this.fetcher(SHELL, {
			cache: "no-cache",
			credentials: "include",
			redirect: "manual",
		}).catch(() => null);
		if (fresh === null) {
			// Offline, or the server is down: what is kept is the best there is.
			return;
		}
		const cache = await this.cache();
		if (!fresh.ok || fresh.type === "opaqueredirect") {
			await cache.delete(SHELL);
		} else {
			const page = await fresh.clone().text();
			if (page === (await cached.text())) {
				return;
			}
			for (const each of await cache.keys()) {
				await cache.delete(each.url);
			}
			await cache.put(SHELL, fresh);
		}
		(await this.windows.get(client))?.postMessage({ type: "splates:reload" });
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
