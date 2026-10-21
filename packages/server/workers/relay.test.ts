import { describe, expect, it } from "bun:test";
import { hasSecret, secretIn } from "./relay";

const head = (origin: string | null) =>
	`GET /api/x HTTP/1.1\r\nhost: 127.0.0.1:1\r\n${origin === null ? "" : `Origin: ${origin}\r\n`}accept: */*`;

describe("hasSecret", () => {
	it("accepts the origin that carries the secret", () => {
		expect(hasSecret(head("http://splates:abc@127.0.0.1:1"), "abc")).toBe(true);
	});

	it("refuses a missing, wrong or absent secret", () => {
		expect(hasSecret(head(null), "abc")).toBe(false);
		expect(hasSecret(head("http://127.0.0.1:1"), "abc")).toBe(false);
		expect(hasSecret(head("http://splates:abd@127.0.0.1:1"), "abc")).toBe(
			false,
		);
		expect(hasSecret(head("not a url"), "abc")).toBe(false);
	});
});

describe("secretIn", () => {
	it("reads the password of the origin", () => {
		expect(secretIn(head("http://splates:abc@127.0.0.1:1"))).toBe("abc");
		expect(secretIn(head("http://127.0.0.1:1"))).toBeNull();
		expect(secretIn(head(null))).toBeNull();
	});
});
