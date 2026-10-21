import { describe, expect, test } from "bun:test";
import { Imds } from "./imds";
import { SsmSecretStore } from "./ssm";
import { systemStores } from "./stores";

const NOW = Date.parse("2026-10-21T10:00:00Z");

/** A fake IMDS and SSM in one fetch. */
class FakeAws {
	clock = NOW;
	issued = 0;
	expiresIn = 60 * 60 * 1000;
	imdsDown = false;
	params = new Map<string, string>();
	signed: Headers[] = [];

	readonly fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		const headers = new Headers(init?.headers);
		if (url.hostname === "169.254.169.254") {
			return this.imds(url.pathname, init?.method ?? "GET", headers);
		}
		return this.ssm(headers, JSON.parse(String(init?.body)));
	}) as typeof fetch;

	readonly imdsClient = () =>
		new Imds({ fetch: this.fetch, now: () => this.clock });

	private imds(path: string, method: string, headers: Headers): Response {
		if (this.imdsDown) {
			return new Response("", { status: 404 });
		}
		if (path === "/latest/api/token") {
			return method === "PUT"
				? new Response("tok")
				: new Response("", { status: 405 });
		}
		if (headers.get("x-aws-ec2-metadata-token") !== "tok") {
			return new Response("", { status: 401 });
		}
		if (path === "/latest/meta-data/placement/region") {
			return new Response("eu-west-1");
		}
		if (path === "/latest/meta-data/iam/security-credentials/") {
			return new Response("box-role");
		}
		this.issued++;
		return Response.json({
			AccessKeyId: `AKIA${this.issued}`,
			SecretAccessKey: "secret",
			Token: `session${this.issued}`,
			Expiration: new Date(this.clock + this.expiresIn).toISOString(),
		});
	}

	private ssm(headers: Headers, body: Record<string, unknown>): Response {
		this.signed.push(headers);
		const target = headers.get("x-amz-target");
		const name = body.Name as string;
		const missing = Response.json(
			{ __type: "ParameterNotFound" },
			{ status: 400 },
		);
		if (target === "AmazonSSM.PutParameter") {
			expect(body.Type).toBe("SecureString");
			this.params.set(name, body.Value as string);
			return Response.json({ Version: 1 });
		}
		if (target === "AmazonSSM.GetParameter") {
			expect(body.WithDecryption).toBe(true);
			const value = this.params.get(name);
			return value === undefined
				? missing
				: Response.json({ Parameter: { Name: name, Value: value } });
		}
		if (target === "AmazonSSM.DeleteParameter") {
			return this.params.delete(name) ? Response.json({}) : missing;
		}
		const all = [...this.params.keys()].filter((key) =>
			key.startsWith(`${body.Path}/`),
		);
		const from = Number(body.NextToken ?? 0);
		const page = all.slice(from, from + 2);
		return Response.json({
			Parameters: page.map((Name) => ({ Name })),
			...(from + 2 < all.length ? { NextToken: String(from + 2) } : {}),
		});
	}
}

function open(aws: FakeAws, prefix = "/splates/device/") {
	return new SsmSecretStore(prefix, {
		fetch: aws.fetch,
		source: aws.imdsClient(),
		now: () => aws.clock,
	});
}

describe("SsmSecretStore", () => {
	test("keeps, reads, lists and deletes values under its prefix", async () => {
		const aws = new FakeAws();
		const store = open(aws);
		expect(await store.get("TOKEN")).toBeUndefined();
		await store.set("TOKEN", "abc");
		await store.set("B", "1");
		await store.set("A", "2");
		await open(aws, "/splates/projects/x/").set("OTHER", "3");
		expect(aws.params.get("/splates/device/TOKEN")).toBe("abc");
		expect(await store.get("TOKEN")).toBe("abc");
		expect(await store.names()).toEqual(["A", "B", "TOKEN"]);
		expect(await store.delete("TOKEN")).toBe(true);
		expect(await store.delete("TOKEN")).toBe(false);
	});

	test("signs each request with the role's credentials", async () => {
		const aws = new FakeAws();
		await open(aws).set("A", "1");
		const headers = aws.signed[0];
		expect(headers?.get("x-amz-security-token")).toBe("session1");
		expect(headers?.get("authorization")).toMatch(
			/^AWS4-HMAC-SHA256 Credential=AKIA1\/20261021\/eu-west-1\/ssm\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target, Signature=[0-9a-f]{64}$/,
		);
	});

	test("refreshes credentials before they expire", async () => {
		const aws = new FakeAws();
		const store = open(aws);
		await store.set("A", "1");
		aws.clock += 50 * 60 * 1000;
		await store.get("A");
		expect(aws.issued).toBe(1);
		aws.clock += 6 * 60 * 1000;
		await store.get("A");
		expect(aws.issued).toBe(2);
		expect(aws.signed.at(-1)?.get("x-amz-security-token")).toBe("session2");
	});

	test("refuses a name no environment could hold", async () => {
		expect(open(new FakeAws()).get("a/b")).rejects.toThrow();
	});

	test("fails loudly on other errors", async () => {
		const store = new SsmSecretStore("/splates/device/", {
			region: "eu-west-1",
			source: new FakeAws().imdsClient(),
			fetch: (async (input: RequestInfo | URL) =>
				String(input).includes("169.254")
					? Response.json({
							AccessKeyId: "a",
							SecretAccessKey: "b",
							Token: "c",
							Expiration: new Date(NOW + 3600_000).toISOString(),
						})
					: Response.json(
							{ __type: "AccessDeniedException" },
							{ status: 400 },
						)) as typeof fetch,
			now: () => NOW,
		});
		expect(store.get("A")).rejects.toThrow();
	});
});

describe("systemStores", () => {
	test("picks Parameter Store when SPLATES_SECRET_STORE=ssm", async () => {
		const aws = new FakeAws();
		const stores = systemStores({
			choice: "ssm",
			imds: aws.imdsClient(),
			ssm: { fetch: aws.fetch },
		});
		await stores.device.set("K", "v");
		expect(aws.params.get("/splates/device/K")).toBe("v");
	});

	test("detects the instance role on Linux when unset", async () => {
		const aws = new FakeAws();
		const stores = systemStores({
			platform: "linux",
			choice: "",
			imds: aws.imdsClient(),
			ssm: { fetch: aws.fetch },
		});
		await stores.device.set("K", "v");
		expect(aws.params.get("/splates/device/K")).toBe("v");
	});

	test("keeps to the keyring when the metadata service is silent", async () => {
		const aws = new FakeAws();
		aws.imdsDown = true;
		const stores = systemStores({
			platform: "linux",
			choice: "",
			imds: aws.imdsClient(),
			ssm: { fetch: aws.fetch },
		});
		// reading touches the keyring, never Parameter Store
		await stores.device.get("NO_SUCH_SPLATES_TEST_KEY").catch(() => {});
		expect(aws.signed).toEqual([]);
	});
});
