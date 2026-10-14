import { beforeAll, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { Access, accessConfig } from "./dev-access";
import { HostGate } from "./dev-http";
import { Exit } from "./exit";

const config = { issuer: "https://team.cloudflareaccess.com", aud: "app-aud" };
const NOW = Date.UTC(2026, 9, 14);

let keys: CryptoKeyPair;
let other: CryptoKeyPair;

beforeAll(async () => {
	const generate = () =>
		crypto.subtle.generateKey(
			{
				name: "RSASSA-PKCS1-v1_5",
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: "SHA-256",
			},
			true,
			["sign", "verify"],
		);
	keys = await generate();
	other = await generate();
});

const encode = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
const part = (value: object) =>
	encode(new TextEncoder().encode(JSON.stringify(value)));

/** A token as Access signs one, `claims` over sound defaults. */
async function token(
	claims: Record<string, unknown> = {},
	{ kid = "k1", signer = keys } = {},
): Promise<string> {
	const signed = `${part({ alg: "RS256", kid })}.${part({
		iss: config.issuer,
		aud: [config.aud],
		exp: NOW / 1000 + 60,
		sub: "user-1",
		email: "me@example.com",
		...claims,
	})}`;
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		signer.privateKey,
		new TextEncoder().encode(signed),
	);
	return `${signed}.${encode(new Uint8Array(signature))}`;
}

/** An `Access` whose certs are `keys` under `k1`, counting each fetch. */
async function access(clock = new FakeWallClock(NOW)) {
	const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
	const fetched: string[] = [];
	const verifier = new Access(config, {
		clock,
		fetch: (async (url: string) => {
			fetched.push(url);
			return Response.json({ keys: [{ ...jwk, kid: "k1" }] });
		}) as unknown as typeof fetch,
	});
	return { verifier, fetched, clock };
}

const asked = (headers: Record<string, string>) =>
	new Request("http://127.0.0.1/api/conversations", { headers });

describe("accessConfig", () => {
	it("is null with neither flag, and the same team however it is named", () => {
		expect(accessConfig("", "")).toBeNull();
		for (const team of [
			"team",
			"Team.cloudflareaccess.com",
			"https://team.cloudflareaccess.com/",
		]) {
			expect(accessConfig(team, "app-aud")).toEqual(config);
		}
	});

	it("refuses one flag without the other, or a team that is no name", () => {
		expect(() => accessConfig("team", "")).toThrow(Exit);
		expect(() => accessConfig("", "app-aud")).toThrow(Exit);
		expect(() => accessConfig("team.example.com/x", "app-aud")).toThrow(Exit);
	});
});

describe("Access", () => {
	it("verifies a token from the header or the cookie", async () => {
		const { verifier, fetched } = await access();
		const signed = await token();

		expect(
			await verifier.verify(asked({ "cf-access-jwt-assertion": signed })),
		).toEqual({ identity: { email: "me@example.com", sub: "user-1" } });
		expect(
			await verifier.verify(
				asked({ cookie: `a=b; CF_Authorization=${signed}` }),
			),
		).toMatchObject({ identity: { sub: "user-1" } });
		expect(fetched).toEqual([
			"https://team.cloudflareaccess.com/cdn-cgi/access/certs",
		]);
	});

	it("refuses a missing, forged, foreign or expired token, saying why", async () => {
		const { verifier } = await access();
		const refused = async (header: string | null) =>
			(
				await verifier.verify(
					asked(header === null ? {} : { "cf-access-jwt-assertion": header }),
				)
			).refused;

		expect(await refused(null)).toContain("no Cloudflare Access token");
		expect(await refused("not.a.jwt")).toContain("token failed");
		expect(await refused(await token({}, { signer: other }))).toContain(
			"bad signature",
		);
		expect(await refused(await token({ aud: ["another"] }))).toContain(
			"another Access application",
		);
		expect(
			await refused(await token({ iss: "https://evil.cloudflareaccess.com" })),
		).toContain("issued by");
		expect(await refused(await token({ exp: NOW / 1000 - 1 }))).toContain(
			"expired",
		);
		expect(await refused(await token({ nbf: NOW / 1000 + 60 }))).toContain(
			"not valid yet",
		);
	});

	it("fetches the keys again for an unknown one, at most once a minute", async () => {
		const { verifier, fetched, clock } = await access();
		const unknown = await token({}, { kid: "k2" });
		const verify = () =>
			verifier.verify(asked({ "cf-access-jwt-assertion": unknown }));

		expect((await verify()).refused).toContain("unknown signing key k2");
		expect((await verify()).refused).toContain("unknown signing key k2");
		expect(fetched).toHaveLength(1);

		clock.advance(Duration.mins(1));
		await verify();
		expect(fetched).toHaveLength(2);
	});
});

describe("HostGate with Access", () => {
	const answered = async () => new Response("ok");
	const request = (host: string, headers: Record<string, string> = {}) =>
		new Request(`http://127.0.0.1/api/conversations`, {
			headers: { host, ...headers },
		});

	it("lets a verified token through to conversations from an allowed host", async () => {
		const { verifier } = await access();
		const gate = new HostGate(
			["arbor.example.com"],
			new MemoryLogger(),
			verifier,
		);
		const through = (asking: Request) =>
			gate.local(gate.guarded(answered))(asking);

		const verified = await through(
			request("arbor.example.com", {
				"cf-access-jwt-assertion": await token(),
			}),
		);
		expect(verified.status).toBe(200);

		const forged = await through(
			request("arbor.example.com", {
				"cf-access-jwt-assertion": await token({}, { signer: other }),
			}),
		);
		expect(forged.status).toBe(403);
		expect(await forged.json()).toMatchObject({
			message: "the Cloudflare Access token failed: bad signature",
		});

		expect((await through(request("localhost:4269"))).status).toBe(200);
	});

	it("says who a verified request comes from, and no one for this machine", async () => {
		const { verifier } = await access();
		const gate = new HostGate(
			["arbor.example.com"],
			new MemoryLogger(),
			verifier,
		);

		expect(
			await gate.identity(
				request("arbor.example.com", {
					"cf-access-jwt-assertion": await token(),
				}),
			),
		).toEqual({ email: "me@example.com", sub: "user-1" });
		expect(
			await gate.identity(
				request("localhost:4269", {
					"cf-access-jwt-assertion": await token(),
				}),
			),
		).toBeNull();
		expect(
			await new HostGate([], new MemoryLogger()).identity(request("localhost")),
		).toBeNull();
	});

	it("asks for a token on every route from an allowed host", async () => {
		const { verifier } = await access();
		const gate = new HostGate(
			["arbor.example.com"],
			new MemoryLogger(),
			verifier,
		);

		const refused = await gate.guarded(answered)(request("arbor.example.com"));

		expect(refused.status).toBe(403);
		expect(await refused.json()).toMatchObject({
			message: "no Cloudflare Access token came with the request",
		});
	});

	it("says Access is off when conversations are asked for without it", async () => {
		const gate = new HostGate(["arbor.example.com"], new MemoryLogger());

		const refused = await gate.local(answered)(request("arbor.example.com"));

		expect(refused.status).toBe(403);
		expect(((await refused.json()) as { message: string }).message).toContain(
			"--access-team and --access-aud",
		);
		expect(
			(await gate.guarded(answered)(request("arbor.example.com"))).status,
		).toBe(200);
	});
});
