import type { Resource } from "core/disposable";
import { sendJson } from "./api";

/** Transport that turns D2 source and a unique salt into an SVG string. */
export interface D2Transport {
	render(source: string, salt: string): Promise<string>;
}

const MAX_CACHED = 64;

/**
 * Turns D2 source into SVG through the splates server, deduplicating
 * in-flight requests and keeping a bounded in-memory cache for the page.
 */
export class D2Draw implements Resource {
	private readonly cache = new Map<string, string>();
	private readonly inflight = new Map<string, Promise<string>>();
	private disposed = false;

	constructor(
		private readonly transport: D2Transport = SERVER_TRANSPORT,
		private readonly maxCached: number = MAX_CACHED,
	) {}

	/** The SVG for `source`, its element ids made unique by `salt`. */
	draw(source: string, salt: string): Promise<string> {
		if (this.disposed) {
			return Promise.reject(new Error("D2 drawer is disposed"));
		}
		const key = `${salt}\0${source}`;
		const cached = this.cache.get(key);
		if (cached !== undefined) {
			this.cache.delete(key);
			this.cache.set(key, cached);
			return Promise.resolve(cached);
		}
		const running = this.inflight.get(key);
		if (running !== undefined) {
			return running;
		}
		const pending = this.transport
			.render(source, salt)
			.then((svg) => {
				if (!this.disposed) {
					this.remember(key, svg);
				}
				return svg;
			})
			.finally(() => {
				this.inflight.delete(key);
			});
		this.inflight.set(key, pending);
		return pending;
	}

	/** Clears cached SVGs and stops accepting new draws. */
	dispose(): void {
		this.disposed = true;
		this.cache.clear();
		this.inflight.clear();
	}

	private remember(key: string, svg: string): void {
		if (this.maxCached <= 0) {
			return;
		}
		if (this.cache.has(key)) {
			this.cache.delete(key);
		} else if (this.cache.size >= this.maxCached) {
			const oldest = this.cache.keys().next().value;
			if (oldest !== undefined) {
				this.cache.delete(oldest);
			}
		}
		this.cache.set(key, svg);
	}
}

const SERVER_TRANSPORT: D2Transport = {
	async render(source: string, salt: string): Promise<string> {
		const body = (await sendJson("/api/d2", "POST", { source, salt })) as {
			svg?: unknown;
		};
		if (typeof body.svg !== "string") {
			throw new Error("server returned no svg");
		}
		return body.svg;
	},
};

/** The one drawer every diagram on the page uses. */
export const D2_DRAW = new D2Draw();
