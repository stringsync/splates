import type { Resource } from "core/disposable";
import { Duration, SystemTimer, type Timer } from "core/time";

/** Minimal surface of `@terrastruct/d2`'s `D2` class that `D2Renderer` uses. */
export interface D2Engine {
	compile(
		source: string,
	): Promise<{ diagram: unknown; renderOptions?: Record<string, unknown> }>;
	render(diagram: unknown, options: Record<string, unknown>): Promise<string>;
	worker?: { terminate?: () => void };
}

/** Options for `D2Renderer`. */
export interface D2RendererOptions {
	/** Creates the D2 runtime on first use; defaults to lazy-loading `@terrastruct/d2`. */
	engine?: () => Promise<D2Engine>;
	/** Schedules idle worker shutdown; defaults to the system timer. */
	timer?: Timer;
	/** How long with no renders before the D2 worker is stopped. */
	idle?: Duration;
	/** Maximum number of rendered SVGs kept in memory. */
	maxCached?: number;
}

const DEFAULT_IDLE = Duration.secs(30);
const DEFAULT_MAX_CACHED = 128;

/**
 * Compiles D2 source to SVG on the server, sharing one lazy D2 worker that
 * stops after an idle timeout and keeping a bounded in-memory LRU cache.
 */
export class D2Renderer implements Resource {
	private readonly createEngine: () => Promise<D2Engine>;
	private readonly timer: Timer;
	private readonly idle: Duration;
	private readonly maxCached: number;
	private engine: Promise<D2Engine> | null = null;
	private tail: Promise<unknown> = Promise.resolve();
	private idleHandle: Resource | null = null;
	private pending = 0;
	private disposed = false;
	private readonly cache = new Map<string, string>();
	private readonly inflight = new Map<string, Promise<string>>();

	constructor(opts: D2RendererOptions = {}) {
		this.createEngine = opts.engine ?? loadD2;
		this.timer = opts.timer ?? new SystemTimer();
		this.idle = opts.idle ?? DEFAULT_IDLE;
		this.maxCached = opts.maxCached ?? DEFAULT_MAX_CACHED;
	}

	/** Renders `source` to an SVG string whose element ids are salted with `salt`. */
	render(source: string, salt: string): Promise<string> {
		if (this.disposed) {
			return Promise.reject(new Error("D2 renderer is disposed"));
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
		this.pending++;
		this.cancelIdle();
		const run = this.tail.then(async () => {
			if (this.disposed) {
				throw new Error("D2 renderer is disposed");
			}
			const engine = await this.start();
			const compiled = await engine.compile(source);
			const svg = await engine.render(compiled.diagram, {
				...compiled.renderOptions,
				salt,
				noXMLTag: true,
			});
			if (!this.disposed) {
				this.remember(key, svg);
			}
			return svg;
		});
		this.tail = run.catch(() => {});
		const settled = run.finally(() => {
			this.inflight.delete(key);
			this.pending--;
			if (!this.disposed && this.pending === 0) {
				this.idleHandle = this.timer.setTimeout(
					() => this.stopWorker(),
					this.idle,
				);
			}
		});
		this.inflight.set(key, settled);
		return settled;
	}

	/** Stops any running D2 worker, cancels idle timers, and clears the cache. */
	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.cancelIdle();
		this.stopWorker();
		this.cache.clear();
		this.inflight.clear();
	}

	private start(): Promise<D2Engine> {
		if (this.engine === null) {
			const created = this.createEngine().catch((error: unknown) => {
				if (this.engine === created) {
					this.engine = null;
				}
				throw error;
			});
			this.engine = created;
		}
		return this.engine;
	}

	private stopWorker(): void {
		this.cancelIdle();
		const engine = this.engine;
		this.engine = null;
		void engine?.then(
			(made) => made.worker?.terminate?.(),
			() => {},
		);
	}

	private cancelIdle(): void {
		this.idleHandle?.dispose();
		this.idleHandle = null;
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

async function loadD2(): Promise<D2Engine> {
	const { D2 } = await import("@terrastruct/d2");
	return new D2() as unknown as D2Engine;
}
