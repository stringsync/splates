import { describe, expect, test } from "bun:test";
import { Exit } from "../exit";
import { type DiagramRenderer, DiagramRoutes, MAX_D2_SOURCE } from "./routes";

describe("DiagramRoutes", () => {
	test("returns the rendered SVG for valid D2 source", async () => {
		const renderer = new FakeDiagramRenderer();
		const routes = new DiagramRoutes(renderer);

		const response = await routes.render(
			post({ source: "a -> b", salt: "r1" }),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			svg: '<svg data-salt="r1">a -> b</svg>',
		});
		expect(renderer.seen).toEqual([{ source: "a -> b", salt: "r1" }]);
	});

	test("derives a deterministic salt when omitted", async () => {
		const renderer = new FakeDiagramRenderer();
		const routes = new DiagramRoutes(renderer);

		const response = await routes.render(post({ source: "a -> b" }));
		expect(response.status).toBe(200);
		expect(renderer.seen).toHaveLength(1);
		expect(renderer.seen[0]?.salt).toMatch(/^[a-z0-9]+$/);
	});

	test("rejects empty, oversized, or malformed requests", async () => {
		const routes = new DiagramRoutes(new FakeDiagramRenderer());
		const reasons = await Promise.all(
			[
				post("not json"),
				post({ source: "" }),
				post({ source: "   " }),
				post({ source: "a".repeat(MAX_D2_SOURCE + 1) }),
				post({ source: "a -> b", salt: "bad salt!" }),
			].map(async (request) => {
				try {
					await routes.render(request);
					return null;
				} catch (error) {
					return error instanceof Exit ? error.reason : "unexpected";
				}
			}),
		);
		expect(reasons).toEqual(["usage", "usage", "usage", "usage", "usage"]);
	});

	test("returns 422 invalid_d2 when compilation fails", async () => {
		const renderer = new FakeDiagramRenderer();
		renderer.failure = new Error("missing closing brace");
		const routes = new DiagramRoutes(renderer);

		const response = await routes.render(post({ source: "a -> {" }));
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			reason: "invalid_d2",
			message: "missing closing brace",
		});
	});
});

class FakeDiagramRenderer implements DiagramRenderer {
	seen: { source: string; salt: string }[] = [];
	failure: Error | null = null;

	async render(source: string, salt: string): Promise<string> {
		this.seen.push({ source, salt });
		if (this.failure !== null) {
			throw this.failure;
		}
		return `<svg data-salt="${salt}">${source}</svg>`;
	}
}

function post(body: unknown): Request {
	return new Request("http://localhost/api/d2", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}
