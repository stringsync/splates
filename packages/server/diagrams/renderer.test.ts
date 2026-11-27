import { describe, expect, test } from "bun:test";
import { Duration } from "core/time";
import { FakeTimer } from "core/time/testing";
import { type D2Engine, D2Renderer } from "./renderer";

describe("D2Renderer", () => {
	test("renders and caches by source and salt", async () => {
		const fake = new FakeD2Engine();
		const timer = new FakeTimer();
		const renderer = new D2Renderer({
			engine: async () => fake,
			timer,
		});
		try {
			const first = await renderer.render("a -> b", "s1");
			const second = await renderer.render("a -> b", "s1");
			const otherSalt = await renderer.render("a -> b", "s2");

			expect(first).toBe('<svg data-salt="s1">a -> b</svg>');
			expect(second).toBe(first);
			expect(otherSalt).toBe('<svg data-salt="s2">a -> b</svg>');
			expect(fake.calls).toHaveLength(2);
		} finally {
			renderer.dispose();
		}
	});

	test("evicts least recently used entries past maxCached", async () => {
		const fake = new FakeD2Engine();
		const renderer = new D2Renderer({
			engine: async () => fake,
			timer: new FakeTimer(),
			maxCached: 2,
		});
		try {
			await renderer.render("a -> b", "s");
			await renderer.render("b -> c", "s");
			// Refresh "a -> b" so "b -> c" becomes oldest.
			await renderer.render("a -> b", "s");
			await renderer.render("c -> d", "s");
			await renderer.render("a -> b", "s");
			await renderer.render("b -> c", "s");

			expect(fake.calls.map((call) => call.source)).toEqual([
				"a -> b",
				"b -> c",
				"c -> d",
				"b -> c",
			]);
		} finally {
			renderer.dispose();
		}
	});

	test("stops the worker after the idle timeout and restarts lazily", async () => {
		const engines: FakeD2Engine[] = [];
		const timer = new FakeTimer();
		const renderer = new D2Renderer({
			engine: async () => {
				const made = new FakeD2Engine();
				engines.push(made);
				return made;
			},
			timer,
			idle: Duration.secs(10),
			maxCached: 0,
		});
		try {
			await renderer.render("a -> b", "s1");
			expect(engines).toHaveLength(1);
			expect(engines[0]?.terminated).toBe(0);

			timer.fireTimeouts();
			await Promise.resolve();
			expect(engines[0]?.terminated).toBe(1);

			await renderer.render("a -> b", "s1");
			expect(engines).toHaveLength(2);
		} finally {
			renderer.dispose();
		}
	});

	test("retries engine creation after a startup failure", async () => {
		let attempts = 0;
		const fake = new FakeD2Engine();
		const renderer = new D2Renderer({
			engine: async () => {
				attempts++;
				if (attempts === 1) {
					throw new Error("startup failed");
				}
				return fake;
			},
			timer: new FakeTimer(),
		});
		try {
			let firstError: unknown = null;
			try {
				await renderer.render("a -> b", "s1");
			} catch (error) {
				firstError = error;
			}
			expect(firstError).toBeInstanceOf(Error);

			const svg = await renderer.render("a -> b", "s1");
			expect(svg).toBe('<svg data-salt="s1">a -> b</svg>');
			expect(attempts).toBe(2);
		} finally {
			renderer.dispose();
		}
	});

	test("rejects new renders and terminates the worker once disposed", async () => {
		const fake = new FakeD2Engine();
		const timer = new FakeTimer();
		const renderer = new D2Renderer({
			engine: async () => fake,
			timer,
		});
		await renderer.render("a -> b", "s1");
		renderer.dispose();
		await Promise.resolve();
		expect(fake.terminated).toBe(1);

		let rejected: unknown = null;
		try {
			await renderer.render("c -> d", "s2");
		} catch (error) {
			rejected = error;
		}
		expect(rejected).toBeInstanceOf(Error);
	});

	test("compiles a real D2 diagram with @terrastruct/d2", async () => {
		const renderer = new D2Renderer();
		try {
			const svg = await renderer.render("a -> b: hello", "smoke");
			expect(svg).toContain("<svg");
			expect(svg).toContain("hello");
		} finally {
			renderer.dispose();
		}
	});
});

class FakeD2Engine implements D2Engine {
	calls: { source: string; salt: string }[] = [];
	terminated = 0;
	failNext: Error | null = null;
	readonly worker = {
		terminate: () => {
			this.terminated++;
		},
	};

	async compile(source: string) {
		if (this.failNext !== null) {
			const error = this.failNext;
			this.failNext = null;
			throw error;
		}
		return { diagram: source, renderOptions: { pad: 10 } };
	}

	async render(diagram: unknown, options: Record<string, unknown>) {
		const source = String(diagram);
		const salt = String(options.salt ?? "");
		this.calls.push({ source, salt });
		return `<svg data-salt="${salt}">${source}</svg>`;
	}
}
