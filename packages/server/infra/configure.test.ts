import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { Creds } from "../creds";
import { Exit } from "../exit";
import { FsStorage } from "../storage";
import { MemoryStorage } from "../storage/testing";
import { API_TOKEN, SavedTunnel } from "../tunnel";
import { CloudflareApi } from "../tunnel/cloudflare-api";
import { tunnelSetup } from "../tunnel/setup";
import { FakeCloudflare } from "../tunnel/testing";
import { infraConfigure, missingPermissions, repositoryOf } from "./configure";
import type { DeployKeyProject } from "./deploy-keys";

describe("infraConfigure", () => {
	it("reads owner/repo off SSH and HTTPS GitHub remotes", () => {
		expect(repositoryOf("git@github.com:me/app.git\n")).toBe("me/app");
		expect(repositoryOf("https://github.com/me/app")).toBe("me/app");
		expect(repositoryOf("git@gitlab.com:me/app.git")).toBeNull();
	});

	it("fills the project from the registry, the tunnel and the creds", async () => {
		const box = await machine({
			SPLATES_DEPLOY_GITHUB_TOKEN_ME: "gh",
			ANTHROPIC_API_KEY: "sk",
		});
		const { written } = await box.configure();
		expect(written).toContain("Pulumi.prod.yaml");
		const stack = await box.fs.read("/infra/Pulumi.prod.yaml");
		// The tunnel's host stays the Mac's until the move takes it over.
		expect(stack).toContain("splates:host: box.splates.example.com");
		expect(stack).toContain("me@example.com");
		expect(stack).toContain("me/app");
		expect(stack).toContain("splates:accountId: acct");
		expect(stack).toContain("splates:zoneId: zone-example.com");
		// The secrets stay in the creds store: nothing is set in the stack.
		expect(box.calls.some((call) => call.argv.includes("set"))).toBe(false);
		expect(stack).not.toContain("secure");
	});

	it("requests a cred that is not kept, and refuses with requested", async () => {
		const box = await machine({});
		const error = await box.configure().catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(Exit);
		expect((error as Exit).reason).toBe("requested");
		const names = (await box.creds.requests()).map((each) => each.name);
		expect(names).toContain("SPLATES_DEPLOY_GITHUB_TOKEN_ME");
		expect(names).toContain("ANTHROPIC_API_KEY");
	});

	it("requests a token for each owner the projects are under, naming its repositories", async () => {
		const box = await machine({
			SPLATES_DEPLOY_GITHUB_TOKEN_ACME: "gh-acme",
			ANTHROPIC_API_KEY: "sk",
		});
		const error = await box
			.configure([
				{ slug: "app", repository: "acme/app" },
				{ slug: "lib", repository: "my-name/lib" },
				{ slug: "web", repository: "my-name/web" },
			])
			.catch((cause: unknown) => cause);
		expect((error as Exit).reason).toBe("requested");
		const requests = await box.creds.requests();
		expect(requests.map((each) => each.name)).toEqual([
			"SPLATES_DEPLOY_GITHUB_TOKEN_MY_NAME",
		]);
		expect(requests[0]?.instructions).toContain("**my-name**");
		expect(requests[0]?.instructions).toContain("`my-name/lib`, `my-name/web`");
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

	it("posts an empty body to each, counting a 403 as missing and a 400 as held", async () => {
		const seen: string[] = [];
		const fetcher = (async (url: string, init: RequestInit) => {
			seen.push(`${init.method} ${url} ${init.body}`);
			return answer(url.includes("service_tokens") ? 403 : 400);
		}) as unknown as typeof fetch;
		const api = new CloudflareApi("t", { fetch: fetcher });
		expect(await missingPermissions(api, "acct", "zone")).toEqual([
			"Account · Access: Service Tokens · Edit",
		]);
		expect(seen).toHaveLength(4);
		expect(
			seen.every((each) => each.startsWith("POST ") && each.endsWith(" {}")),
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

async function machine(kept: Record<string, string>) {
	const cloudflare = new FakeCloudflare().zone("example.com");
	const store = new FakeSecretStore({ [API_TOKEN]: "api-token", ...kept });
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
			return {
				exitCode: 0,
				stdout: argv[1] === "remote" ? "git@github.com:me/app.git\n" : "",
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
