import { describe, expect, it } from "bun:test";
import { Jev } from "./jev";
import { JUDGMENT, serve } from "./system-one-testing";

describe("Jev", () => {
	it("posts the judgment with its model and reads the answers", async () => {
		const server = serve({ answers: { lookup: 0.8 } });
		const verdict = await new Jev("key", { fetch: server.fetch }).judge(
			JUDGMENT,
		);
		expect(verdict.answers.get("lookup")).toBe(0.8);
		const [request] = server.requests;
		expect(request?.url).toBe("https://api.typesafe.ai/v1/systemone");
		expect(new Headers(request?.init.headers).get("authorization")).toBe(
			"Bearer key",
		);
		expect(JSON.parse(String(request?.init.body))).toEqual({
			model: "jev-latest",
			...JUDGMENT,
		});
	});

	it("says what went wrong without the URL", async () => {
		const server = serve({ error: "no" }, 401);
		await expect(
			new Jev("key", { fetch: server.fetch }).judge(JUDGMENT),
		).rejects.toThrow("Jev answered 401");
	});
});
