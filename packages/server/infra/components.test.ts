import { expect, test } from "bun:test";
import * as pulumi from "@pulumi/pulumi";

interface Made {
	type: string;
	name: string;
	inputs: Record<string, unknown>;
}

const made: Made[] = [];

pulumi.runtime.setMocks({
	newResource: (args) => {
		made.push({ type: args.type, name: args.name, inputs: args.inputs });
		const state =
			args.type === "awsx:ec2:Vpc"
				? { ...args.inputs, vpcId: "vpc-1", publicSubnetIds: ["subnet-1"] }
				: args.inputs;
		return { id: `${args.name}-id`, state };
	},
	call: (args) =>
		args.token === "aws:ec2/getAmi:getAmi" ? { id: "ami-1" } : args.inputs,
});

const { CoordinatorBox, DeployKeys, Tunnel } = await import("./index");

/** Resources register as the engine gets to them, so wait for the first of a type. */
async function ofType(type: string): Promise<Made[]> {
	for (let tries = 0; tries < 100; tries++) {
		const found = made.filter((resource) => resource.type === type);
		if (found.length > 0) {
			return found;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return [];
}

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
