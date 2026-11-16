import { describe, expect, test } from "bun:test";
import { parseEnv, Scrubber } from "./scrub";

describe("scrubber", () => {
	test("values from .env files become their name", () => {
		const scrubber = Scrubber.fromEnvFiles([
			'# comment\nDB_PASSWORD=hunter2hunter2\nexport API="quoted value here"\nPORT=3000\nNOTE=abcdefg # trailing',
		]);
		expect(scrubber.scrub("login hunter2hunter2 ok, port 3000")).toBe(
			"login [REDACTED:DB_PASSWORD] ok, port 3000",
		);
		expect(scrubber.scrub("sent quoted value here")).toBe(
			"sent [REDACTED:API]",
		);
		expect(scrubber.scrub("abcdefg")).toBe("[REDACTED:NOTE]");
	});

	test("a value holding another is redacted whole", () => {
		const scrubber = new Scrubber({ SHORT: "secret1", LONG: "secret1-extra" });
		expect(scrubber.scrub("x secret1-extra y")).toBe("x [REDACTED:LONG] y");
	});

	test("later .env files win", () => {
		expect(parseEnv("A=first1")).toEqual({ A: "first1" });
		const scrubber = Scrubber.fromEnvFiles(["A=first1", "A=second"]);
		expect(scrubber.scrub("first1 second")).toBe("first1 [REDACTED:A]");
	});

	test("bearer tokens", () => {
		expect(scrub("Authorization: Bearer abc123DEF456ghi")).toBe(
			"Authorization: Bearer [REDACTED:BEARER]",
		);
	});

	test("JWTs", () => {
		expect(
			scrub("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl end"),
		).toBe("token [REDACTED:JWT] end");
	});

	test("sk- keys", () => {
		expect(scrub("key sk-proj-abcdefghijklmnop1234")).toBe("key [REDACTED:SK]");
	});

	test("AWS access key ids", () => {
		expect(scrub("id AKIAIOSFODNN7EXAMPLE.")).toBe("id [REDACTED:AWS].");
	});

	test("long hex runs", () => {
		expect(scrub("sha 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822c")).toBe(
			"sha [REDACTED:HEX]",
		);
	});

	test("long random base64 runs, but not words, slugs or short ids", () => {
		expect(scrub("v=Zm9vYmFyQmF6MTIzNDU2Nzg5MEFiQ2RFZkdoSWo=")).toBe(
			"v=[REDACTED:RANDOM]",
		);
		const plain =
			"GET /api/a-very-long-kebab-case-slug-for-an-article/comments abc123";
		expect(scrub(plain)).toBe(plain);
	});
});

function scrub(text: string): string {
	return new Scrubber().scrub(text);
}
