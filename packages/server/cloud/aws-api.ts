import {
	Duration,
	SystemWallClock,
	sleep,
	type WallClock,
} from "webappwiz/time";
import { dailyBackupPolicy } from "./aws-backups";
import type { AwsCredentialSource } from "./aws-credentials";
import { AwsError, queryError } from "./aws-error";
import {
	type AwsApiOptions,
	type AwsImage,
	type AwsInstance,
	type AwsRule,
	type AwsSecurityGroup,
	flatten,
	instanceOf,
	type NewInstance,
	type Params,
	rulesOf,
	runParams,
	tagFilter,
	tagList,
	tagsOf,
} from "./aws-shapes";
import { AwsSigner, encode } from "./aws-sign";
import { AwsXml, type XmlValue } from "./aws-xml";

const EC2_VERSION = "2016-11-15";
const STS_VERSION = "2011-06-15";

/**
 * The AWS APIs, as far as splates makes machines in the user's own account:
 * EC2 for instances, images, key pairs and security groups, STS for the
 * account's id, and Data Lifecycle Manager for backups, each signed with
 * Signature Version 4. Tags, and names for key pairs and security groups,
 * are how splates finds what it made: it keeps no state of its own about them.
 */
export class AwsApi {
	private readonly wall: WallClock;
	private readonly wait: (duration: Duration) => Promise<void>;
	private readonly fetch: typeof globalThis.fetch;

	constructor(
		private readonly source: AwsCredentialSource,
		readonly region: string,
		opts: AwsApiOptions = {},
	) {
		this.wall = opts.wall ?? new SystemWallClock();
		this.wait = opts.wait ?? sleep;
		this.fetch = opts.fetch ?? globalThis.fetch;
	}

	/** Whether the credentials found are ones AWS takes. */
	async accepted(): Promise<boolean> {
		if ((await this.source.credentials()) === null) {
			return false;
		}
		try {
			await this.account();
			return true;
		} catch (error) {
			if (error instanceof AwsError && error.status < 500) {
				return false;
			}
			throw error;
		}
	}

	/** The id of the account the credentials belong to. */
	async account(): Promise<string> {
		const answer = await this.query(
			"sts",
			`sts.${this.region}.amazonaws.com`,
			STS_VERSION,
			"GetCallerIdentity",
			{},
		);
		return AwsXml.str(
			AwsXml.field(AwsXml.field(answer, "GetCallerIdentityResult"), "Account"),
		);
	}

	/** The names of the instance types among `types` that can be ordered in the region now. */
	async offered(types: string[]): Promise<Set<string>> {
		const offered = new Set<string>();
		let token: string | undefined;
		do {
			const answer = await this.ec2("DescribeInstanceTypeOfferings", {
				LocationType: "region",
				Filter: [{ Name: "instance-type", Value: types }],
				...(token === undefined ? {} : { NextToken: token }),
			});
			for (const each of AwsXml.list(answer.instanceTypeOfferingSet)) {
				offered.add(AwsXml.str(AwsXml.field(each, "instanceType")));
			}
			token = AwsXml.str(answer.nextToken) || undefined;
		} while (token !== undefined);
		return offered;
	}

	/** Instance `id`, or null when there is none or it is terminated. */
	async instance(id: string): Promise<AwsInstance | null> {
		try {
			const [found] = await this.instances({ InstanceId: [id] });
			return found ?? null;
		} catch (error) {
			if (
				error instanceof AwsError &&
				error.code === "InvalidInstanceID.NotFound"
			) {
				return null;
			}
			throw error;
		}
	}

	/** The instances that are not terminated and carry `tag`, with `value` when given. */
	async taggedInstances(tag: string, value?: string): Promise<AwsInstance[]> {
		return this.instances({ Filter: [tagFilter(tag, value)] });
	}

	/** Runs an instance, answering it once AWS has made it and it is booting. */
	async runInstance(spec: NewInstance): Promise<AwsInstance> {
		const answer = await this.ec2("RunInstances", runParams(spec));
		const [made] = AwsXml.list(answer.instancesSet);
		return instanceOf(made);
	}

	/** What instance `id` has printed to its console, decoded; "" before it has printed any. */
	async consoleOutput(id: string): Promise<string> {
		const answer = await this.ec2("GetConsoleOutput", { InstanceId: id });
		return Buffer.from(AwsXml.str(answer.output), "base64").toString("utf8");
	}

	/** Terminates instance `id`; silent when it is already gone. */
	async terminate(id: string): Promise<void> {
		try {
			await this.ec2("TerminateInstances", { InstanceId: [id] });
		} catch (error) {
			if (
				!(
					error instanceof AwsError &&
					error.code === "InvalidInstanceID.NotFound"
				)
			) {
				throw error;
			}
		}
	}

	/** Turns on or off the protection that refuses terminating instance `id`. */
	async protect(id: string, on: boolean): Promise<void> {
		await this.ec2("ModifyInstanceAttribute", {
			InstanceId: id,
			"DisableApiTermination.Value": on,
		});
	}

	/** Sets `tags` on the resources `ids`. */
	async tag(ids: string[], tags: Record<string, string>): Promise<void> {
		await this.ec2("CreateTags", { ResourceId: ids, Tag: tagList(tags) });
	}

	/** The newest image `owner` made whose name matches `name`, as `ubuntu/images/*`, or null. */
	async newestImage(owner: string, name: string): Promise<string | null> {
		const answer = await this.ec2("DescribeImages", {
			"Owner.1": owner,
			Filter: [
				{ Name: "name", Value: [name] },
				{ Name: "state", Value: ["available"] },
			],
		});
		const images = AwsXml.list(answer.imagesSet).map((each) => ({
			id: AwsXml.str(AwsXml.field(each, "imageId")),
			at: AwsXml.str(AwsXml.field(each, "creationDate")),
		}));
		images.sort((left, right) => (left.at < right.at ? 1 : -1));
		return images[0]?.id ?? null;
	}

	/** Images instance `id`, answering the image's id once it is available. */
	async createImage(
		id: string,
		name: string,
		description: string,
		tags: Record<string, string>,
	): Promise<string> {
		const answer = await this.ec2("CreateImage", {
			InstanceId: id,
			Name: name,
			Description: description,
			NoReboot: false,
			TagSpecification: [
				{ ResourceType: "image", Tag: tagList(tags) },
				{ ResourceType: "snapshot", Tag: tagList(tags) },
			],
		});
		const image = AwsXml.str(answer.imageId);
		for (let waited = 0; waited < IMAGE_LIMIT.ms; waited += IMAGE_POLL.ms) {
			const state = (await this.images({ "ImageId.1": image }))[0]?.state;
			if (state === "available") {
				return image;
			}
			if (state === "failed" || state === "error") {
				throw new Error(`AWS could not make image ${image} (${state})`);
			}
			await this.wait(IMAGE_POLL);
		}
		throw new Error(
			`AWS did not finish image ${image} within ${IMAGE_LIMIT.mins} minutes`,
		);
	}

	/** The ids of the images of this account that carry `tag`, with `value` when given. */
	async taggedImages(tag: string, value?: string): Promise<string[]> {
		const found = await this.images({
			"Owner.1": "self",
			Filter: [tagFilter(tag, value)],
		});
		return found.map((each) => each.id);
	}

	/** Deregisters image `id` and deletes the snapshots behind it; silent when it is already gone. */
	async deleteImage(id: string): Promise<void> {
		let found: AwsImage | undefined;
		try {
			[found] = await this.images({ "ImageId.1": id });
		} catch (error) {
			if (error instanceof AwsError && error.code.startsWith("InvalidAMIID")) {
				return;
			}
			throw error;
		}
		if (found === undefined) {
			return;
		}
		await this.ec2("DeregisterImage", { ImageId: id });
		for (const snapshot of found.snapshots) {
			await this.ec2("DeleteSnapshot", { SnapshotId: snapshot }).catch(
				(error) => {
					if (
						!(
							error instanceof AwsError &&
							error.code === "InvalidSnapshot.NotFound"
						)
					) {
						throw error;
					}
				},
			);
		}
	}

	/** The key pair named `name`, or null. */
	async keyPair(
		name: string,
	): Promise<{ tags: Record<string, string> } | null> {
		try {
			const answer = await this.ec2("DescribeKeyPairs", { KeyName: [name] });
			const [found] = AwsXml.list(answer.keySet);
			return found === undefined
				? null
				: { tags: tagsOf(AwsXml.field(found, "tagSet")) };
		} catch (error) {
			if (
				error instanceof AwsError &&
				error.code === "InvalidKeyPair.NotFound"
			) {
				return null;
			}
			throw error;
		}
	}

	/** Imports `publicKey` as key pair `name`, tagged `tags`. */
	async importKeyPair(
		name: string,
		publicKey: string,
		tags: Record<string, string>,
	): Promise<void> {
		await this.ec2("ImportKeyPair", {
			KeyName: name,
			PublicKeyMaterial: Buffer.from(publicKey).toString("base64"),
			TagSpecification: [{ ResourceType: "key-pair", Tag: tagList(tags) }],
		});
	}

	/** Deletes key pair `name`; AWS is silent when there is none. */
	async deleteKeyPair(name: string): Promise<void> {
		await this.ec2("DeleteKeyPair", { KeyName: name });
	}

	/** The subnet tagged `tag`, with the VPC it is in, or null. */
	async subnet(tag: string): Promise<{ id: string; vpcId: string } | null> {
		const answer = await this.ec2("DescribeSubnets", {
			Filter: [{ Name: "tag-key", Value: [tag] }],
		});
		const [found] = AwsXml.list(answer.subnetSet);
		return found === undefined
			? null
			: {
					id: AwsXml.str(AwsXml.field(found, "subnetId")),
					vpcId: AwsXml.str(AwsXml.field(found, "vpcId")),
				};
	}

	/** The security group named `name` in `vpcId`, with the rules it has, or null. */
	async securityGroup(
		name: string,
		vpcId: string,
	): Promise<AwsSecurityGroup | null> {
		const answer = await this.ec2("DescribeSecurityGroups", {
			Filter: [
				{ Name: "group-name", Value: [name] },
				{ Name: "vpc-id", Value: [vpcId] },
			],
		});
		const [found] = AwsXml.list(answer.securityGroupInfo);
		if (found === undefined) {
			return null;
		}
		return {
			id: AwsXml.str(AwsXml.field(found, "groupId")),
			rules: AwsXml.list(AwsXml.field(found, "ipPermissions")).flatMap(rulesOf),
		};
	}

	/** Makes the security group `name` in `vpcId`, answering its id. */
	async createSecurityGroup(name: string, vpcId: string): Promise<string> {
		const answer = await this.ec2("CreateSecurityGroup", {
			GroupName: name,
			GroupDescription: "splates",
			VpcId: vpcId,
			TagSpecification: [
				{ ResourceType: "security-group", Tag: tagList({ Name: name }) },
			],
		});
		return AwsXml.str(answer.groupId);
	}

	/** Adds `rules` to, or takes them from, the group `id`. */
	async changeRules(id: string, rules: AwsRule[], add: boolean): Promise<void> {
		if (rules.length === 0) {
			return;
		}
		await this.ec2(
			add ? "AuthorizeSecurityGroupIngress" : "RevokeSecurityGroupIngress",
			{
				GroupId: id,
				IpPermissions: rules.map((rule) => ({
					IpProtocol: rule.protocol,
					FromPort: rule.from,
					ToPort: rule.to,
					...(rule.source.includes(":")
						? { Ipv6Ranges: [{ CidrIpv6: rule.source }] }
						: { IpRanges: [{ CidrIp: rule.source }] }),
				})),
			},
		);
	}

	/** Deletes the security group `id`; silent when it is already gone. */
	async deleteSecurityGroup(id: string): Promise<void> {
		try {
			await this.ec2("DeleteSecurityGroup", { GroupId: id });
		} catch (error) {
			if (
				!(error instanceof AwsError && error.code === "InvalidGroup.NotFound")
			) {
				throw error;
			}
		}
	}

	/** Turns on a daily snapshot, kept a week, of every instance tagged `tag`=`value`, once, as one policy. */
	async ensureDailyBackups(
		tag: string,
		value: string,
		role: string,
	): Promise<void> {
		const base = `dlm.${this.region}.amazonaws.com`;
		const listed = await this.rest(
			base,
			"GET",
			`/policies?targetTags=${encodeURIComponent(`${tag}=${value}`)}`,
			null,
		);
		const policies = (listed as { Policies?: unknown[] }).Policies ?? [];
		if (policies.length > 0) {
			return;
		}
		await this.rest(
			base,
			"POST",
			"/policies",
			dailyBackupPolicy(
				tag,
				value,
				`arn:aws:iam::${await this.account()}:role/${role}`,
			),
		);
	}

	private async instances(params: Params): Promise<AwsInstance[]> {
		const answer = await this.ec2("DescribeInstances", {
			...params,
			Filter: [
				...((params.Filter as Params[] | undefined) ?? []),
				{
					Name: "instance-state-name",
					Value: ["pending", "running", "stopping", "stopped"],
				},
			],
		});
		return AwsXml.list(answer.reservationSet).flatMap((reservation) =>
			AwsXml.list(AwsXml.field(reservation, "instancesSet")).map(instanceOf),
		);
	}

	private async images(params: Params): Promise<AwsImage[]> {
		const answer = await this.ec2("DescribeImages", params);
		return AwsXml.list(answer.imagesSet).map((each) => ({
			id: AwsXml.str(AwsXml.field(each, "imageId")),
			state: AwsXml.str(AwsXml.field(each, "imageState")),
			snapshots: AwsXml.list(AwsXml.field(each, "blockDeviceMapping"))
				.map((mapping) =>
					AwsXml.str(AwsXml.field(AwsXml.field(mapping, "ebs"), "snapshotId")),
				)
				.filter((snapshot) => snapshot !== ""),
		}));
	}

	private async ec2(
		action: string,
		params: Params,
	): Promise<{ [name: string]: XmlValue }> {
		return this.query(
			"ec2",
			`ec2.${this.region}.amazonaws.com`,
			EC2_VERSION,
			action,
			params,
		);
	}

	/** Calls a Query API action, answering the root element's fields. */
	private async query(
		service: string,
		host: string,
		version: string,
		action: string,
		params: Params,
	): Promise<{ [name: string]: XmlValue }> {
		const body = [...flatten({ Action: action, Version: version, ...params })]
			.map(([name, value]) => `${encode(name)}=${encode(value)}`)
			.join("&");
		const response = await this.send(service, host, "POST", "/", body, {
			"Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
		});
		const text = await response.text();
		if (!response.ok) {
			throw queryError(text, response.status);
		}
		return AwsXml.parse(text);
	}

	/** Calls a JSON REST API, as Data Lifecycle Manager's. */
	private async rest(
		host: string,
		method: string,
		path: string,
		body: unknown,
	): Promise<unknown> {
		const response = await this.send(
			"dlm",
			host,
			method,
			path,
			body === null ? "" : JSON.stringify(body),
			{
				"Content-Type": "application/json",
			},
		);
		const text = await response.text();
		if (!response.ok) {
			throw new AwsError(
				response.headers.get("x-amzn-errortype") ?? "Unknown",
				text.slice(0, 200),
				response.status,
			);
		}
		return text === "" ? {} : JSON.parse(text);
	}

	private async send(
		service: string,
		host: string,
		method: string,
		path: string,
		body: string,
		headers: Record<string, string>,
	): Promise<Response> {
		const credentials = await this.source.credentials();
		if (credentials === null) {
			throw new Error(
				"no AWS credentials: sign in as the AWS CLI would (a profile, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY), or run on an EC2 instance with a role",
			);
		}
		const url = new URL(`https://${host}${path}`);
		const signed = new AwsSigner(credentials, this.region, service).sign(
			{ method, url, headers, body },
			new Date(this.wall.now()),
		);
		return this.fetch(url, {
			method,
			headers: signed,
			...(body === "" ? {} : { body }),
		});
	}
}

/** How often, and how long, an image being made is watched. */
const IMAGE_POLL = Duration.secs(15);
const IMAGE_LIMIT = Duration.mins(40);
