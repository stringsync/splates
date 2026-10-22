import { expect, test } from "bun:test";
import { mockPulumi } from "./testing";

process.env.SPLATES_DEPLOY_GITHUB_TOKEN_ME = "tok-me";
process.env.SPLATES_DEPLOY_GITHUB_TOKEN_ONE = "tok-one";
process.env.SPLATES_DEPLOY_GITHUB_TOKEN_TWO = "tok-two";

const ofType = mockPulumi();

const { CoordinatorBox, DeployKeys, Tunnel } = await import("./index");

test("the box is one hardened instance with its creds as secure parameters", async () => {
	const box = new CoordinatorBox("t", {
		host: "splates.example.com",
		secrets: { SPLATES_TUNNEL_TOKEN: "tok" },
	});
	await box.instanceId.apply(() => {});
	const [instance] = await ofType("aws:ec2/instance:Instance");
	expect(instance?.inputs).toMatchObject({
		instanceType: "t3.medium",
		disableApiTermination: true,
		metadataOptions: { httpTokens: "required", httpPutResponseHopLimit: 1 },
	});
	// The deploy logs in as root with the stack's key, on a box that installs bun itself.
	expect(instance?.inputs.keyName).toBeDefined();
	expect(instance?.inputs.userData).toContain("bun.sh/install");
	expect(await ofType("aws:ec2/keyPair:KeyPair")).toHaveLength(1);
	const [parameter] = await ofType("aws:ssm/parameter:Parameter");
	expect(parameter?.inputs).toMatchObject({
		name: "/splates/device/SPLATES_TUNNEL_TOKEN",
		type: "SecureString",
	});
	expect((await ofType("awsx:ec2:Vpc"))[0]?.inputs).toMatchObject({
		subnetSpecs: [{ tags: { "splates-worker-subnet": "true" } }],
	});
	expect(
		(await ofType("aws:iam/instanceProfile:InstanceProfile")).map(
			(profile) => profile.inputs.name,
		),
	).toContain("splates-worker");
	expect(
		(await ofType("aws:iam/role:Role")).map((role) => role.inputs.name),
	).toContain("AWSDataLifecycleManagerDefaultRole");
	expect(await ofType("aws:dlm/lifecyclePolicy:LifecyclePolicy")).toHaveLength(
		1,
	);
});

test("a tunnel makes its DNS record, an Access application and a service token", async () => {
	const tunnel = new Tunnel("t", {
		host: "splates.example.com",
		email: "me@example.com",
		accountId: "acct",
		zoneId: "zone",
	});
	await tunnel.token.apply(() => {});
	expect(
		await new Promise<string>((resolve) => tunnel.tunnelId.apply(resolve)),
	).toBe("t-tunnel-id");
	// Apart from the name `splates tunnel setup` gives this Mac's tunnel.
	expect(
		(
			await ofType(
				"cloudflare:index/zeroTrustTunnelCloudflared:ZeroTrustTunnelCloudflared",
			)
		)[0]?.inputs.name,
	).toBe("t-coordinator");
	expect(await ofType("cloudflare:index/dnsRecord:DnsRecord")).toHaveLength(1);
	expect(
		await ofType(
			"cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication",
		),
	).toHaveLength(1);
	expect(
		await ofType(
			"cloudflare:index/zeroTrustAccessServiceToken:ZeroTrustAccessServiceToken",
		),
	).toHaveLength(1);
});

test("each project gets a deploy key with write access and its parameter", async () => {
	const keys = new DeployKeys("t", {
		projects: [{ slug: "app", repository: "me/app" }],
	});
	expect(keys.parameters).toEqual({
		app: "/splates/projects/app/SPLATES_DEPLOY_KEY",
	});
	const [key] = await ofType(
		"github:index/repositoryDeployKey:RepositoryDeployKey",
	);
	expect(key?.inputs).toMatchObject({ repository: "app", readOnly: false });
});

test("projects under two owners each get a deploy key on their owner's provider", async () => {
	new DeployKeys("two", {
		projects: [
			{ slug: "a", repository: "one/a" },
			{ slug: "b", repository: "two/b" },
			{ slug: "c", repository: "one/c" },
		],
	});
	// Resources register as the engine gets to them, after the first provider of the earlier test is found.
	await new Promise((resolve) => setTimeout(resolve, 200));
	const providers = await ofType("pulumi:providers:github");
	expect(
		providers
			.map(
				(provider) =>
					`${provider.inputs.owner} ${(provider.inputs.token as { value: string }).value}`,
			)
			.sort(),
	).toEqual(["me tok-me", "one tok-one", "two tok-two"]);
});
