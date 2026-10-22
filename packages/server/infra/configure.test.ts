import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { Creds } from "../creds";
import { FsStorage } from "../storage";
import { MemoryStorage } from "../storage/testing";
import { API_TOKEN, SavedTunnel } from "../tunnel";
import { CloudflareApi } from "../tunnel/cloudflare-api";
import { tunnelSetup } from "../tunnel/setup";
import { FakeCloudflare } from "../tunnel/testing";
import { infraConfigure, missingPermissions, repositoryOf } from "./configure";
import type { DeployKeyProject } from "./deploy-keys";
import { SECRET_PLACEHOLDER } from "./secrets";

describe("infraConfigure", () => {
	it("reads owner/repo off SSH and HTTPS GitHub remotes", () => {
		expect(repositoryOf("git@github.com:me/app.git\n")).toBe("me/app");
		expect(repositoryOf("https://github.com/me/app")).toBe("me/app");
		expect(repositoryOf("git@gitlab.com:me/app.git")).toBeNull();
	});

	it("fills the project from the registry and the tunnel, with no secret in it", async () => {
		const box = await machine();
		const { written, secrets } = await box.configure();
		expect(written).toContain("Pulumi.prod.yaml");
		const stack = await box.fs.read("/infra/Pulumi.prod.yaml");
		// The tunnel's host stays the Mac's until the move takes it over.
		expect(stack).toContain("splates:host: box.splates.example.com");
		expect(stack).toContain("me@example.com");
		expect(stack).toContain("me/app");
		expect(stack).toContain("splates:accountId: acct");
		expect(stack).toContain("splates:zoneId: zone-example.com");
		expect(stack).toContain("splates/secrets");
		expect(stack).not.toContain("api-token");
		expect(secrets).toEqual([
			"cloudflare:apiToken",
			"splates:githubToken-me",
			"splates:anthropicKey",
		]);
		expect(box.calls.some((call) => call.argv.includes("config"))).toBe(false);
	});

	it("makes the ESC environment with a placeholder for each secret, and no value", async () => {
		const box = await machine();
		await box.configure();
		const init = box.calls.find((call) => call.argv[2] === "init");
		expect(init?.argv).toEqual([
			"pulumi",
			"env",
			"init",
			"me/splates/secrets",
			"-f",
			"-",
		]);
		const config = (
			Bun.YAML.parse(init?.stdin ?? "") as {
				values: { pulumiConfig: Record<string, string> };
			}
		).values.pulumiConfig;
		expect(config).toEqual({
			"cloudflare:apiToken": SECRET_PLACEHOLDER,
			"splates:githubToken-me": SECRET_PLACEHOLDER,
			"splates:anthropicKey": SECRET_PLACEHOLDER,
		});
	});

	it("adds a placeholder for a new owner's token, leaving the secrets pasted already", async () => {
		const box = await machine(
			[
				"values:",
				"  pulumiConfig:",
				"    cloudflare:apiToken:",
				"      fn::secret:",
				"        ciphertext: ZXNjeAAA",
				"    splates:githubToken-acme:",
				"      fn::secret:",
				"        ciphertext: ZXNjeBBB",
				`    splates:anthropicKey: ${SECRET_PLACEHOLDER}`,
				"",
			].join("\n"),
		);
		await box.configure([
			{ slug: "app", repository: "acme/app" },
			{ slug: "lib", repository: "my-name/lib" },
		]);
		const changes = box.calls.filter(
			(call) => call.argv[2] === "set" || call.argv[2] === "init",
		);
		expect(changes.map((call) => call.argv.slice(2))).toEqual([
			[
				"set",
				"me/splates/secrets",
				'pulumiConfig["splates:githubToken-my-name"]',
				SECRET_PLACEHOLDER,
				"--string",
			],
		]);
	});
});

describe("missingPermissions", () => {
	const answer = (status: number) =>
		new Response(
			JSON.stringify({
				success: false,
				errors: [{ message: "x", code: 1 }],
				result: null,
			}),
			{ status },
		);

	it("posts an empty body to each edit and gets each read, counting a 403 as missing and a 400 as held", async () => {
		const seen: string[] = [];
		const fetcher = (async (url: string, init: RequestInit) => {
			seen.push(`${init.method} ${url} ${init.body}`);
			return answer(
				url.includes("service_tokens") || url.includes("organizations")
					? 403
					: 400,
			);
		}) as unknown as typeof fetch;
		const api = new CloudflareApi("t", { fetch: fetcher });
		expect(await missingPermissions(api, "acct", "zone")).toEqual([
			"Account · Access: Service Tokens · Edit",
			"Account · Access: Organizations, Identity Providers, and Groups · Read",
		]);
		expect(seen).toHaveLength(5);
		expect(seen.filter((each) => each.startsWith("GET "))).toEqual([
			"GET https://api.cloudflare.com/client/v4/accounts/acct/access/organizations undefined",
		]);
		expect(
			seen
				.filter((each) => !each.startsWith("GET "))
				.every((each) => each.startsWith("POST ") && each.endsWith(" {}")),
		).toBe(true);
	});

	it("stops on an answer that is not Cloudflare's", async () => {
		const api = new CloudflareApi("t", {
			fetch: (async () => {
				throw new Error("offline");
			}) as unknown as typeof fetch,
		});
		await expect(missingPermissions(api, "a", "z")).rejects.toThrow("offline");
	});
});

async function machine(definition: string | null = null) {
	const cloudflare = new FakeCloudflare().zone("example.com");
	const store = new FakeSecretStore({ [API_TOKEN]: "api-token" });
	const fs = new FakeFs();
	const creds = new Creds(new MemoryStorage(), {
		project: new FakeSecretStore(),
		device: store,
	});
	const saved = SavedTunnel.in(new FsStorage("/home/.splates", fs), store);
	await tunnelSetup({
		host: "splates.example.com",
		email: "me@example.com",
		name: "splates",
		team: "",
		creds,
		task: null,
		saved,
		log: new MemoryLogger(),
		fetch: cloudflare.fetch,
	});
	const calls: { argv: string[]; stdin?: string }[] = [];
	const ps = {
		spawnCapture: async (argv: string[], opts?: SpawnOpts) => {
			calls.push({ argv, stdin: opts?.stdin });
			const asks = argv.join(" ");
			if (asks.startsWith("pulumi env get")) {
				return definition === null
					? { exitCode: 255, stdout: "", stderr: "[404] Not Found" }
					: { exitCode: 0, stdout: definition, stderr: "" };
			}
			return {
				exitCode: 0,
				stdout:
					argv[1] === "remote"
						? "git@github.com:me/app.git\n"
						: asks === "pulumi org get-default"
							? "me\n"
							: "",
				stderr: "",
			};
		},
	} as unknown as Ps;
	const configure = (projects: DeployKeyProject[] | null = null) =>
		infraConfigure({
			dir: "/infra",
			stack: "prod",
			region: "us-east-1",
			host: "",
			email: "",
			projects,
			registered: async () => [{ slug: "app", root: "/code/app" }],
			creds,
			saved,
			fs,
			ps,
			log: new MemoryLogger(),
			fetch: cloudflare.fetch,
		});
	return { cloudflare, creds, fs, calls, configure };
}

interface SpawnOpts {
	stdin?: string;
}
