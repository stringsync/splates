import { describe, expect, it } from "bun:test";
import { Clef } from "./clef";
import { Jev } from "./jev";
import { judgeFrom } from "./judge";

describe("judgeFrom", () => {
	const creds = (kept: Record<string, string>) => ({
		get: async (name: string) => kept[name],
	});

	it("prefers Jev, then Clef, else none", async () => {
		expect(
			await judgeFrom(
				creds({
					TYPESAFE_API_KEY: "k",
					CLOUDFLARE_ACCOUNT_ID: "a",
					CLOUDFLARE_API_TOKEN: "t",
				}),
			),
		).toBeInstanceOf(Jev);
		expect(
			await judgeFrom(
				creds({ CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" }),
			),
		).toBeInstanceOf(Clef);
		expect(await judgeFrom(creds({ CLOUDFLARE_ACCOUNT_ID: "a" }))).toBeNull();
	});
});
