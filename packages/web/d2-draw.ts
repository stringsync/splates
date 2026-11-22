import type { Resource } from "core/disposable";

/** The browser build of D2, whose instance owns a worker holding the whole WASM runtime. */
type Engine = InstanceType<typeof import("@terrastruct/d2").D2>;

// How long nothing draws before the worker stops.
const IDLE_MS = 30_000;

/**
 * Turns D2 source into SVG. Call `draw` with a diagram's source and a unique
 * salt; every caller shares one runtime. Call `dispose` to free it early.
 */
export class D2Draw implements Resource {
	// One drawing runs at a time, as the engine answers a single call at once;
	// the worker stops once nothing has drawn for IDLE_MS.
	private engine: Promise<Engine> | null = null;
	private tail: Promise<unknown> = Promise.resolve();
	private idle: ReturnType<typeof setTimeout> | null = null;
	private pending = 0;

	/** The SVG for `source`, its element ids made unique by `salt`. */
	draw(source: string, salt: string): Promise<string> {
		this.pending++;
		if (this.idle !== null) {
			clearTimeout(this.idle);
			this.idle = null;
		}
		const run = this.tail.then(async () => {
			const engine = await this.start();
			const result = await engine.compile(source);
			const svg = await engine.render(result.diagram, {
				...result.renderOptions,
				salt,
				noXMLTag: true,
			});
			return svg;
		});
		this.tail = run.catch(() => {});
		return run.finally(() => {
			this.pending--;
			if (this.pending === 0) {
				this.idle = setTimeout(() => this.dispose(), IDLE_MS);
			}
		});
	}

	/** Stops the engine's worker; a later `draw` starts a new one. */
	dispose(): void {
		if (this.idle !== null) {
			clearTimeout(this.idle);
			this.idle = null;
		}
		const engine = this.engine;
		this.engine = null;
		void engine?.then(
			(made) =>
				(
					made as unknown as { worker?: { terminate?: () => void } }
				).worker?.terminate?.(),
			() => {},
		);
	}

	private start(): Promise<Engine> {
		this.engine ??= import("@terrastruct/d2").then(({ D2 }) => new D2());
		return this.engine;
	}
}

/** The one engine every diagram on the page draws with. */
export const D2_DRAW = new D2Draw();
