import { beforeEach, describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { AwsCloud, AwsCredentialSource } from "./index";
import { FakeAws } from "./testing";
import { CloudWorkers } from "./workers";

describe("CloudWorkers in AWS", () => {
	let aws: FakeAws;
	let ps: FakePs;
	let cloud: AwsCloud;
	let stuck: boolean;
	let provider: CloudWorkers;

	beforeEach(() => {
		aws = new FakeAws();
		aws.stock = ["m7i.xlarge", "t3.medium"];
		ps = new FakePs();
		ps.setEnv({
			AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
			AWS_SECRET_ACCESS_KEY: "secret",
		});
		stuck = false;
		const wait = async () => {
			if (!stuck) {
				for (const builder of aws.tagged("splates-snapshot-builder")) {
					builder.state = "stopped";
				}
			}
		};
		const wall = { now: () => 1000 };
		cloud = new AwsCloud({
			credentials: new AwsCredentialSource({ ps, wall }),
			fetch: aws.fetch,
			wall,
			wait,
		});
		provider = new CloudWorkers(cloud, { wall, wait });
	});

	it("offers its size, billed by the second, while the region can make it", async () => {
		expect(await provider.types()).toEqual([
			{
				name: "m7i.xlarge",
				platform: "linux",
				slots: 4,
				dollarsPerHour: 0.2016,
				spotDollarsPerHour: 0.08,
				billing: "second",
			},
		]);

		aws.stock = ["t3.medium"];
		expect(await provider.types()).toEqual([]);
	});

	it("makes a worker tagged with its id in the stack's subnet, from the snapshot, its boot in its user data", async () => {
		await provider.create({
			id: "m7i.xlarge-abc123",
			type: "m7i.xlarge",
			snapshot: "ami-77",
			join: ["splates", "worker", "join"],
			joinEnv: { SPLATES_WORKER_JOIN: "secret-token" },
			boot: ["splates", "worker", "run", "--key-file"],
		});

		const [worker] = aws.tagged("splates-worker", "m7i.xlarge-abc123");
		expect(worker).toMatchObject({
			type: "m7i.xlarge",
			imageId: "ami-77",
			subnetId: "subnet-public",
			profile: "splates-worker",
			diskGb: 50,
			tags: { Name: "m7i.xlarge-abc123" },
		});
		expect(worker?.userData).toContain(
			"'SPLATES_WORKER_JOIN=secret-token' 'splates' 'worker' 'join'; do",
		);
		expect(worker?.userData).not.toMatch(/ExecStart=.*secret-token/);
		// splates is a bun script, and systemd's own PATH has no bun.
		expect(worker?.userData).toContain(
			"Environment=PATH=/home/splates/.bun/bin:/usr/local/sbin:",
		);
		expect(await provider.list()).toEqual([
			{ id: "m7i.xlarge-abc123", type: "m7i.xlarge", spot: true },
		]);
		expect(worker?.spot).toBe(true);
		expect(worker?.userData).toContain("splates-spot-watch.service");
	});

	it("makes a worker on demand, and says so, when EC2 has no spot capacity", async () => {
		aws.refuseSpot = "InsufficientInstanceCapacity";
		const spec = {
			type: "m7i.xlarge",
			snapshot: "ami-1",
			join: [],
			joinEnv: {},
			boot: [],
		};
		await provider.create({ id: "a", ...spec });
		expect(aws.tagged("splates-worker", "a")[0]?.spot).toBe(false);
		expect(await provider.list()).toEqual([
			{ id: "a", type: "m7i.xlarge", spot: false },
		]);
		const asked = aws.requests.filter((each) => each.action === "RunInstances");
		expect(asked).toHaveLength(2);

		aws.refuseSpot = "UnauthorizedOperation";
		await expect(provider.create({ id: "b", ...spec })).rejects.toThrow();
	});

	it("destroys a worker's instance alone, and says why AWS refused one", async () => {
		const spec = {
			type: "m7i.xlarge",
			snapshot: "ami-1",
			join: [],
			joinEnv: {},
			boot: [],
		};
		await provider.create({ id: "w", ...spec });
		await provider.create({ id: "v", ...spec });

		await provider.destroy("w");
		await provider.destroy("gone");

		expect(await provider.list()).toEqual([
			{ id: "v", type: "m7i.xlarge", spot: true },
		]);

		aws.refuseRun = "vCPU limit reached";
		await expect(provider.create({ id: "u", ...spec })).rejects.toThrow(
			"vCPU limit reached",
		);
		expect(aws.instances.size).toBe(1);
	});

	it("builds a snapshot on a small builder from the newest Ubuntu, tags it, then lets the builder and the last snapshot go", async () => {
		aws.images.set("ami-old", {
			id: "ami-old",
			owner: aws.account,
			name: "old",
			state: "available",
			tags: { "splates-snapshot": "linux" },
			snapshotId: "snap-old",
			createdAt: "2026-02-01T00:00:00.000Z",
		});
		aws.snapshots.add("snap-old");

		const snapshot = await provider.snapshot({
			platform: "linux",
			version: "1.2.3",
			script: "#!/bin/sh\necho recipe\n",
		});

		const ran = aws.requests.find((each) => each.action === "RunInstances");
		expect(ran?.params).toMatchObject({
			InstanceType: "t3.medium",
			ImageId: "ami-ubuntu",
		});
		expect(aws.instances.size).toBe(0);
		expect([...aws.images.keys()]).toEqual(["ami-ubuntu", snapshot.id]);
		expect(aws.images.get(snapshot.id)?.tags).toEqual({
			"splates-snapshot": "linux",
		});
		expect([...aws.snapshots]).toHaveLength(1);
	});

	it("lets the builder go, keeping the last snapshot, when the recipe never finishes", async () => {
		stuck = true;

		await expect(
			provider.snapshot({ platform: "linux", version: "1.2.3", script: "" }),
		).rejects.toThrow("did not finish within 40 minutes");

		expect(aws.instances.size).toBe(0);
	});

	it("takes the sign-in only once AWS does", async () => {
		expect(await cloud.accepted()).toBe(true);

		ps.setEnv({ AWS_ACCESS_KEY_ID: "AKIAWRONG", AWS_SECRET_ACCESS_KEY: "x" });
		expect(await cloud.accepted()).toBe(false);
	});
});

describe("AwsCloud", () => {
	let aws: FakeAws;
	let cloud: AwsCloud;

	beforeEach(() => {
		aws = new FakeAws();
		const ps = new FakePs();
		ps.setEnv({
			AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
			AWS_SECRET_ACCESS_KEY: "secret",
		});
		cloud = new AwsCloud({
			credentials: new AwsCredentialSource({ ps }),
			fetch: aws.fetch,
		});
	});

	it("reads what an instance printed to its console", async () => {
		const id = "i-0box";
		aws.instances.set(id, {
			id,
			state: "running",
			type: "t3.medium",
			imageId: "ami-1",
			subnetId: "subnet-1",
			zone: "us-east-1a",
			ip: "203.0.113.7",
			tags: {},
			userData: "",
			keyName: null,
			securityGroupIds: [],
			profile: null,
			diskGb: 50,
			launchedAt: new Date(0).toISOString(),
			spot: false,
			terminationProtected: false,
		});
		aws.console.set(id, "-----BEGIN SSH HOST KEY KEYS-----\n");

		expect(await cloud.consoleOutput(id)).toBe(
			"-----BEGIN SSH HOST KEY KEYS-----\n",
		);
		await expect(cloud.consoleOutput("i-nope")).rejects.toThrow();
	});

	it("keeps a firewall's rules exactly, adding before it takes away", async () => {
		const id = await cloud.ensureFirewall("splates-box", [
			{
				direction: "in",
				protocol: "tcp",
				port: "22",
				sourceIps: ["0.0.0.0/0", "::/0"],
			},
			{ direction: "in", protocol: "icmp", port: "", sourceIps: ["10.0.0.1"] },
		]);

		await cloud.ensureFirewall("splates-box", [
			{
				direction: "in",
				protocol: "tcp",
				port: "22",
				sourceIps: ["0.0.0.0/0"],
			},
			{
				direction: "in",
				protocol: "tcp",
				port: "8000-8010",
				sourceIps: ["0.0.0.0/0"],
			},
		]);

		expect(aws.groups.get(id)?.rules).toEqual([
			{ protocol: "tcp", from: 22, to: 22, source: "0.0.0.0/0" },
			{ protocol: "tcp", from: 8000, to: 8010, source: "0.0.0.0/0" },
		]);
		await cloud.removeFirewall("splates-box");
		await cloud.removeFirewall("splates-box");
		expect(aws.groups.size).toBe(0);
	});

	it("replaces a key pair only when its public key changed", async () => {
		await cloud.ensureSshKey("splates", "ssh-ed25519 AAAA one");
		await cloud.ensureSshKey("splates", "ssh-ed25519 AAAA one\n");
		expect(
			aws.actions().filter((each) => each === "ImportKeyPair"),
		).toHaveLength(1);

		await cloud.ensureSshKey("splates", "ssh-ed25519 BBBB two");
		expect(
			aws.actions().filter((each) => each === "ImportKeyPair"),
		).toHaveLength(2);
		expect(aws.actions()).toContain("DeleteKeyPair");

		await cloud.removeSshKey("splates");
		expect(aws.keys.size).toBe(0);
	});

	it("protects a machine from termination, and backs it up daily with one policy", async () => {
		const machine = await cloud.create({
			name: "box",
			type: "t3.medium",
			image: "ubuntu-24.04",
			location: "us-east-1",
			userData: "",
			tags: { "splates-box": "yes" },
		});

		await cloud.protect(machine.id, true);
		await cloud.enableBackups(machine.id);
		await cloud.enableBackups(machine.id);

		expect(await cloud.machine(machine.id)).toMatchObject({
			name: "box",
			status: "running",
			protected: true,
			backups: true,
			tags: { "splates-box": "yes" },
		});
		await expect(cloud.delete(machine.id)).rejects.toThrow(
			"OperationNotPermitted",
		);
		expect(aws.policies).toHaveLength(1);
		expect(aws.policies[0]).toMatchObject({
			ExecutionRoleArn: `arn:aws:iam::${aws.account}:role/AWSDataLifecycleManagerDefaultRole`,
		});

		await cloud.protect(machine.id, false);
		await cloud.delete(machine.id);
		expect(await cloud.machine(machine.id)).toBeNull();
	});

	it("refuses a location other than its region, and a stack that is not there", async () => {
		const spec = {
			name: "box",
			type: "t3.medium",
			image: "ubuntu-24.04",
			userData: "",
			tags: {},
		};

		await expect(
			cloud.create({ ...spec, location: "eu-west-1" }),
		).rejects.toThrow("makes machines in us-east-1");

		aws.subnetTagged = false;
		await expect(
			cloud.create({ ...spec, location: "us-east-1" }),
		).rejects.toThrow("deploy the splates stack");
	});
});

describe("AwsCredentialSource", () => {
	it("falls to the AWS CLI, then to the instance role, keeping temporary ones until they near their end", async () => {
		const ps = new FakePs();
		ps.simulate(async () => 1);
		let now = 0;
		const asked: string[] = [];
		const fetch = (async (url: string, init?: RequestInit) => {
			asked.push(`${init?.method} ${new URL(url).pathname}`);
			if (url.endsWith("/api/token")) {
				return new Response("token");
			}
			if (url.endsWith("/security-credentials/")) {
				return new Response("splates-box");
			}
			return Response.json({
				AccessKeyId: "A",
				SecretAccessKey: "S",
				Token: "T",
				Expiration: new Date(10 * 60_000).toISOString(),
			});
		}) as unknown as typeof globalThis.fetch;
		const source = new AwsCredentialSource({
			ps,
			fetch,
			wall: { now: () => now },
		});

		expect(await source.credentials()).toEqual({
			accessKeyId: "A",
			secretAccessKey: "S",
			sessionToken: "T",
		});
		await source.credentials();
		expect(asked).toHaveLength(3);

		now = 6 * 60_000;
		await source.credentials();
		expect(asked).toHaveLength(6);
	});

	it("reads what the AWS CLI exports for a profile", async () => {
		const ps = new FakePs();
		ps.setCaptureOutput(
			JSON.stringify({ Version: 1, AccessKeyId: "P", SecretAccessKey: "Q" }),
			"",
		);

		const source = new AwsCredentialSource({ ps });

		expect(await source.credentials()).toEqual({
			accessKeyId: "P",
			secretAccessKey: "Q",
		});
		expect(ps.getCalls()[0]).toContain("export-credentials");
	});

	it("signs in through the Pulumi ESC environment when the CLI has nothing, keeping it for most of the hour", async () => {
		const ps = new FakePs();
		const calls: string[] = [];
		ps.spawnCapture = async (argv) => {
			calls.push(argv.join(" "));
			const line = argv.join(" ");
			if (argv[0] === "aws") {
				return { exitCode: 1, stdout: "", stderr: "" };
			}
			if (line === "pulumi org get-default") {
				return { exitCode: 0, stdout: "acme\n", stderr: "" };
			}
			return {
				exitCode: 0,
				stderr: "",
				stdout: JSON.stringify({
					environmentVariables: {
						AWS_ACCESS_KEY_ID: "E",
						AWS_SECRET_ACCESS_KEY: "F",
						AWS_SESSION_TOKEN: "G",
					},
				}),
			};
		};
		let now = 0;
		const source = new AwsCredentialSource({ ps, wall: { now: () => now } });

		expect(await source.credentials()).toEqual({
			accessKeyId: "E",
			secretAccessKey: "F",
			sessionToken: "G",
		});
		expect(calls).toContain("pulumi env open acme/splates/aws --format json");
		const opened = calls.length;
		now = 50 * 60_000;
		await source.credentials();
		expect(calls).toHaveLength(opened);
		now = 56 * 60_000;
		await source.credentials();
		expect(calls.length).toBeGreaterThan(opened);
	});

	it("has none off an EC2 box with no sign-in", async () => {
		const ps = new FakePs();
		ps.simulate(async () => 1);
		const fetch = (async () => {
			throw new Error("no route to host");
		}) as unknown as typeof globalThis.fetch;

		expect(
			await new AwsCredentialSource({ ps, fetch }).credentials(),
		).toBeNull();
	});
});
