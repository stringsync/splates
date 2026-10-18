import { beforeEach, describe, expect, it } from "bun:test";
import { createVerify, generateKeyPairSync, type KeyObject } from "node:crypto";
import { GitHubApp, githubRepo } from "./github-app";

describe("GitHubApp", () => {
	const now = Date.parse("2026-10-17T12:00:00Z");
	let publicKey: KeyObject;
	let privateKey: string;
	/** The authorization header of each request the App made. */
	let sent: string[];
	let app: GitHubApp;

	beforeEach(() => {
		const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
		publicKey = pair.publicKey;
		privateKey = pair.privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString();
		sent = [];
		app = new GitHubApp("42", privateKey, {
			now: () => now,
			fetch: (async (_url: string, init?: RequestInit) => {
				sent.push(new Headers(init?.headers).get("authorization") ?? "");
				return new Response("Not Found", { status: 404 });
			}) as typeof fetch,
		});
	});

	const decode = (part: string) =>
		JSON.parse(Buffer.from(part, "base64url").toString());
	const verifies = (jwt: string) => {
		const [header = "", claims = "", signature = ""] = jwt.split(".");
		return createVerify("RSA-SHA256")
			.update(`${header}.${claims}`)
			.verify(publicKey, signature, "base64url");
	};

	it("signs a JWT GitHub takes, issued as the App, for under ten minutes", () => {
		const jwt = app.jwt();

		expect(jwt.split(".").slice(0, 2).map(decode)).toEqual([
			{ alg: "RS256", typ: "JWT" },
			{ iat: now / 1000 - 60, exp: now / 1000 + 9 * 60, iss: "42" },
		]);
		expect(verifies(jwt)).toBe(true);
	});

	it("asks with its JWT, and says what GitHub said when it refuses", async () => {
		await expect(app.token({ owner: "o", name: "r" })).rejects.toThrow(
			"GitHub GET /repos/o/r/installation: 404 Not Found",
		);
		expect(
			sent.map((header) => verifies(header.replace(/^Bearer /, ""))),
		).toEqual([true]);
	});

	it("signs with a key whose line breaks a password field stripped", () => {
		const pasted = new GitHubApp("42", privateKey.replaceAll("\n", ""), {
			now: () => now,
		});

		expect(verifies(pasted.jwt())).toBe(true);
	});

	it("reads the repository from each shape of github.com URL", () => {
		expect(
			[
				"git@github.com:stringsync/splates.git",
				"ssh://git@github.com/stringsync/splates.git",
				"https://github.com/stringsync/splates",
				"https://x-access-token@github.com/stringsync/splates.git",
			].map(githubRepo),
		).toEqual(Array(4).fill({ owner: "stringsync", name: "splates" }));
	});

	it("names no repository for a remote elsewhere", () => {
		expect(
			["/tmp/remote.git", "git@gitlab.com:o/r.git"].map(githubRepo),
		).toEqual([null, null]);
	});
});
