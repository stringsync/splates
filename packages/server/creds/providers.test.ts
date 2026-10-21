import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { Testing } from "../testing";
import { AwsKeys } from "./aws";
import { Creds } from "./creds";

describe("Creds providers", () => {
	let deps: Testing;
	let ssmProject: FakeSecretStore;
	let ssmDevice: FakeSecretStore;
	let creds: Creds;

	beforeEach(async () => {
		deps = await Testing.open();
		ssmProject = new FakeSecretStore({}, "ssm project");
		ssmDevice = new FakeSecretStore({}, "ssm device");
		creds = new Creds(
			deps.storage,
			{ project: deps.projectStore, device: deps.deviceStore },
			{ project: ssmProject, device: ssmDevice },
		);
	});

	afterEach(() => deps.disposeAsync());

	it("offers the system's first and Parameter Store after", () => {
		expect(creds.providers).toEqual(["system", "ssm"]);
		expect(deps.creds.providers).toEqual(["system"]);
	});

	it("keeps a value with the provider asked for and lists it under that provider", async () => {
		await creds.save("A_TOKEN", "one", { scope: "device", provider: "ssm" });
		await creds.save("B_TOKEN", "two", { scope: "device" });

		expect(await ssmDevice.get("A_TOKEN")).toBe("one");
		expect(await deps.deviceStore.get("A_TOKEN")).toBeUndefined();
		expect(await deps.deviceStore.get("B_TOKEN")).toBe("two");
		expect(await creds.kept()).toEqual([
			{ name: "B_TOKEN", scope: "device", provider: "system", savedBy: null },
			{ name: "A_TOKEN", scope: "device", provider: "ssm", savedBy: null },
		]);
	});

	it("reads from Parameter Store first, and removes from the provider named", async () => {
		await deps.deviceStore.set("A_TOKEN", "system");
		await ssmDevice.set("A_TOKEN", "ssm");
		expect(await creds.credentials.get("A_TOKEN")).toBe("ssm");

		expect(await creds.remove("A_TOKEN", "device", "ssm")).toBe(true);
		expect(await creds.credentials.get("A_TOKEN")).toBe("system");
	});

	it("fills a request with the provider the person picked over the one asked", async () => {
		await creds.request("C_TOKEN", {
			scope: "project",
			provider: "system",
			purpose: "why",
			instructions: "how",
			task: null,
		});
		await creds.save("C_TOKEN", "v", { provider: "ssm" });

		expect(await ssmProject.get("C_TOKEN")).toBe("v");
		expect(await deps.projectStore.get("C_TOKEN")).toBeUndefined();
	});

	it("lists the rest when Parameter Store cannot be reached", async () => {
		ssmDevice.names = () => Promise.reject(new Error("no AWS keys"));
		await creds.save("B_TOKEN", "two", { scope: "device" });
		expect((await creds.kept()).map((each) => each.name)).toEqual(["B_TOKEN"]);
	});

	it("refuses Parameter Store where it is not a provider", async () => {
		expect(
			deps.creds.save("A_TOKEN", "v", { provider: "ssm" }),
		).rejects.toThrow();
	});
});

describe("AwsKeys", () => {
	let home: string;

	beforeEach(async () => {
		home = await mkdtemp(join(tmpdir(), "aws-keys-"));
	});
	afterEach(() => rm(home, { recursive: true }));

	it("reads the environment first", async () => {
		const keys = new AwsKeys({
			home,
			env: {
				AWS_ACCESS_KEY_ID: "AK",
				AWS_SECRET_ACCESS_KEY: "SK",
				AWS_REGION: "eu-west-2",
			},
		});
		expect(await keys.credentials()).toMatchObject({
			accessKeyId: "AK",
			secretAccessKey: "SK",
			sessionToken: "",
		});
		expect(await keys.region()).toBe("eu-west-2");
	});

	it("reads the named profile of ~/.aws", async () => {
		await mkdir(join(home, ".aws"));
		await writeFile(
			join(home, ".aws", "credentials"),
			"[default]\naws_access_key_id = NO\naws_secret_access_key = NO\n\n[work]\naws_access_key_id = AK\naws_secret_access_key = SK\naws_session_token = TOK\n",
		);
		await writeFile(
			join(home, ".aws", "config"),
			"[default]\nregion = us-east-1\n\n[profile work]\nregion = ap-south-1\n",
		);
		const keys = new AwsKeys({ home, env: { AWS_PROFILE: "work" } });
		expect(await keys.credentials()).toMatchObject({
			accessKeyId: "AK",
			sessionToken: "TOK",
		});
		expect(await keys.region()).toBe("ap-south-1");
	});

	it("is unavailable with no keys anywhere", async () => {
		expect(await new AwsKeys({ home, env: {} }).available()).toBe(false);
	});
});
