import { describe, expect, test } from "bun:test";
import { D2Draw, type D2Transport } from "./d2-draw";

describe("D2Draw", () => {
	test("does nothing when disposed unused", () => {
		expect(() => new D2Draw().dispose()).not.toThrow();
	});

	test("caches rendered SVGs and deduplicates in-flight requests", async () => {
		const transport = new FakeD2Transport();
		transport.defer = true;
		const drawer = new D2Draw(transport);

		const first = drawer.draw("a -> b", "s1");
		const second = drawer.draw("a -> b", "s1");
		expect(transport.calls).toHaveLength(1);

		transport.pending[0]?.resolve("<svg>a -> b</svg>");
		expect(await first).toBe("<svg>a -> b</svg>");
		expect(await second).toBe("<svg>a -> b</svg>");

		expect(await drawer.draw("a -> b", "s1")).toBe("<svg>a -> b</svg>");
		expect(transport.calls).toHaveLength(1);
	});

	test("retries after a failed render instead of caching the error", async () => {
		const transport = new FakeD2Transport();
		transport.defer = true;
		const drawer = new D2Draw(transport);

		const failing = drawer.draw("a -> b", "s1");
		transport.pending[0]?.reject(new Error("temporary failure"));
		let caught: unknown = null;
		try {
			await failing;
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(Error);

		transport.defer = false;
		expect(await drawer.draw("a -> b", "s1")).toBe(
			'<svg data-salt="s1">a -> b</svg>',
		);
		expect(transport.calls).toHaveLength(2);
	});
});

class FakeD2Transport implements D2Transport {
	calls: { source: string; salt: string }[] = [];
	pending: { resolve: (svg: string) => void; reject: (err: Error) => void }[] =
		[];
	defer = false;

	render(source: string, salt: string): Promise<string> {
		this.calls.push({ source, salt });
		if (this.defer) {
			return new Promise<string>((resolve, reject) => {
				this.pending.push({ resolve, reject });
			});
		}
		return Promise.resolve(`<svg data-salt="${salt}">${source}</svg>`);
	}
}
