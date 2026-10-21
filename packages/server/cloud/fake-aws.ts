/** An instance as `FakeAws` keeps it. */
export interface FakeInstance {
	id: string;
	/** pending, running, stopping or stopped. */
	state: string;
	type: string;
	imageId: string;
	subnetId: string;
	zone: string;
	ip: string | null;
	tags: Record<string, string>;
	userData: string;
	keyName: string | null;
	securityGroupIds: string[];
	profile: string | null;
	diskGb: number;
	terminationProtected: boolean;
	launchedAt: string;
}

/** An image as `FakeAws` keeps it. */
export interface FakeImage {
	id: string;
	owner: string;
	name: string;
	state: string;
	tags: Record<string, string>;
	snapshotId: string;
	createdAt: string;
}

/** A security group as `FakeAws` keeps it, one rule per source as `AwsApi` reads them. */
export interface FakeGroup {
	id: string;
	name: string;
	vpcId: string;
	rules: { protocol: string; from: number; to: number; source: string }[];
}

/** A request `FakeAws` was sent. */
export interface FakeAwsRequest {
	service: string;
	/** The Query action, or `METHOD /path` for a REST API. */
	action: string;
	params: Record<string, string>;
}

type Fields = Record<string, unknown>;

/**
 * AWS in memory, as `AwsApi` calls it, for tests: its `fetch` answers the
 * EC2 and STS Query APIs and Data Lifecycle Manager's REST one, with one
 * public subnet tagged as the stack tags it and Canonical's Ubuntu image.
 */
export class FakeAws {
	/** Instance types orderable now. */
	stock: string[] = [];
	readonly instances = new Map<string, FakeInstance>();
	readonly images = new Map<string, FakeImage>();
	readonly snapshots = new Set<string>();
	readonly keys = new Map<string, { tags: Record<string, string> }>();
	readonly groups = new Map<string, FakeGroup>();
	readonly policies: unknown[] = [];
	readonly requests: FakeAwsRequest[] = [];
	/** When set, running an instance is refused with it. */
	refuseRun: string | null = null;
	/** Whether the stack's subnet exists. */
	subnetTagged = true;
	/** The state an instance is made in. */
	bootState = "running";
	private next = 100;

	constructor(
		private readonly accessKeyId = "AKIAEXAMPLE",
		readonly account = "123456789012",
	) {
		this.images.set("ami-ubuntu", {
			id: "ami-ubuntu",
			owner: "099720109477",
			name: "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20260101",
			state: "available",
			tags: {},
			snapshotId: "snap-ubuntu",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
	}

	/** The subnet the stack made, in the VPC of that name. */
	readonly subnetId = "subnet-public";
	readonly vpcId = "vpc-splates";

	readonly fetch = (async (url: URL | string, init?: RequestInit) => {
		const target = new URL(url);
		const auth = new Headers(init?.headers).get("Authorization") ?? "";
		if (!auth.startsWith(`AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/`)) {
			return error(
				403,
				"InvalidClientTokenId",
				"the security token is invalid",
			);
		}
		const service = target.host.split(".")[0] as string;
		if (service === "dlm") {
			return this.dlm(
				init?.method ?? "GET",
				target,
				init?.body as string | null,
			);
		}
		const params = Object.fromEntries(
			new URLSearchParams(init?.body as string),
		);
		const action = params.Action as string;
		this.requests.push({ service, action, params });
		return this.answer(action, params);
	}) as unknown as typeof globalThis.fetch;

	/** Puts an instance in place as though it had been made, with `fields` over a running one's. */
	put(fields: Partial<FakeInstance>): FakeInstance {
		const id = `i-${this.next++}`;
		const instance: FakeInstance = {
			id,
			state: "running",
			type: "m7i.xlarge",
			imageId: "ami-ubuntu",
			subnetId: this.subnetId,
			zone: "us-east-1a",
			ip: `203.0.113.${this.next % 256}`,
			tags: {},
			userData: "",
			keyName: null,
			securityGroupIds: [],
			profile: null,
			diskGb: 50,
			terminationProtected: false,
			launchedAt: new Date(0).toISOString(),
			...fields,
		};
		this.instances.set(id, instance);
		return instance;
	}

	/** The actions asked, in order. */
	actions(): string[] {
		return this.requests.map((each) => each.action);
	}

	/** The instances carrying tag `key`, or `key=value`. */
	tagged(key: string, value?: string): FakeInstance[] {
		return [...this.instances.values()].filter(
			(each) =>
				key in each.tags && (value === undefined || each.tags[key] === value),
		);
	}

	private answer(action: string, params: Record<string, string>): Response {
		switch (action) {
			case "GetCallerIdentity":
				return xml(action, {
					GetCallerIdentityResult: { Account: this.account },
				});
			case "DescribeInstanceTypeOfferings": {
				const asked = filters(params).find(
					(each) => each.name === "instance-type",
				)?.values;
				return xml(action, {
					instanceTypeOfferingSet: this.stock
						.filter((type) => asked === undefined || asked.includes(type))
						.map((instanceType) => ({ instanceType, locationType: "region" })),
				});
			}
			case "DescribeInstances": {
				const ids = list(params, "InstanceId");
				const missing = ids.find((id) => !this.instances.has(id));
				if (missing !== undefined) {
					return error(
						400,
						"InvalidInstanceID.NotFound",
						`The instance ID '${missing}' does not exist`,
					);
				}
				const found = [...this.instances.values()]
					.filter((each) => ids.length === 0 || ids.includes(each.id))
					.filter((each) =>
						matches(filters(params), (name) =>
							name === "instance-state-name"
								? [each.state]
								: name === "instance-type"
									? [each.type]
									: tagValues(each.tags, name),
						),
					);
				return xml(action, {
					reservationSet: found.map((each) => ({
						instancesSet: [instanceXml(each)],
					})),
				});
			}
			case "RunInstances": {
				if (this.refuseRun !== null) {
					return error(400, "InstanceLimitExceeded", this.refuseRun);
				}
				const tags = Object.assign({}, ...tagSpecs(params, "instance"));
				const instance = this.put({
					state: this.bootState,
					type: params.InstanceType as string,
					imageId: params.ImageId as string,
					subnetId: params["NetworkInterface.1.SubnetId"] as string,
					securityGroupIds: list(params, "NetworkInterface.1.SecurityGroupId"),
					userData: Buffer.from(params.UserData ?? "", "base64").toString(),
					keyName: params.KeyName ?? null,
					profile: params["IamInstanceProfile.Name"] ?? null,
					diskGb: Number(params["BlockDeviceMapping.1.Ebs.VolumeSize"]),
					tags,
				});
				return xml(action, { instancesSet: [instanceXml(instance)] });
			}
			case "TerminateInstances": {
				for (const id of list(params, "InstanceId")) {
					const instance = this.instances.get(id);
					if (instance === undefined) {
						return error(
							400,
							"InvalidInstanceID.NotFound",
							`The instance ID '${id}' does not exist`,
						);
					}
					if (instance.terminationProtected) {
						return error(
							400,
							"OperationNotPermitted",
							`The instance '${id}' may not be terminated`,
						);
					}
					this.instances.delete(id);
				}
				return xml(action, {});
			}
			case "ModifyInstanceAttribute": {
				const instance = this.instances.get(params.InstanceId as string);
				if (instance !== undefined) {
					instance.terminationProtected =
						params["DisableApiTermination.Value"] === "true";
				}
				return xml(action, { return: true });
			}
			case "CreateTags": {
				for (const id of list(params, "ResourceId")) {
					const target = this.instances.get(id);
					if (target !== undefined) {
						Object.assign(target.tags, tagPairs(params, "Tag"));
					}
				}
				return xml(action, { return: true });
			}
			case "DescribeImages": {
				const ids = list(params, "ImageId");
				const missing = ids.find((id) => !this.images.has(id));
				if (missing !== undefined) {
					return error(
						400,
						"InvalidAMIID.NotFound",
						`The image id '${missing}' does not exist`,
					);
				}
				const own = params["Owner.1"];
				const found = [...this.images.values()]
					.filter((each) => ids.length === 0 || ids.includes(each.id))
					.filter(
						(each) =>
							own === undefined ||
							(own === "self"
								? each.owner === this.account
								: each.owner === own),
					)
					.filter((each) =>
						matches(filters(params), (name) =>
							name === "name"
								? [each.name]
								: name === "state"
									? [each.state]
									: tagValues(each.tags, name),
						),
					);
				return xml(action, {
					imagesSet: found.map((each) => ({
						imageId: each.id,
						imageState: each.state,
						creationDate: each.createdAt,
						blockDeviceMapping: [
							{ deviceName: "/dev/sda1", ebs: { snapshotId: each.snapshotId } },
						],
					})),
				});
			}
			case "CreateImage": {
				const instance = this.instances.get(params.InstanceId as string);
				if (instance === undefined) {
					return error(400, "InvalidInstanceID.NotFound", "no such instance");
				}
				const id = `ami-${this.next++}`;
				const snapshotId = `snap-${this.next++}`;
				this.snapshots.add(snapshotId);
				this.images.set(id, {
					id,
					owner: this.account,
					name: params.Name as string,
					state: "available",
					tags: Object.assign({}, ...tagSpecs(params, "image")),
					snapshotId,
					createdAt: new Date().toISOString(),
				});
				return xml(action, { imageId: id });
			}
			case "DeregisterImage":
				this.images.delete(params.ImageId as string);
				return xml(action, { return: true });
			case "DeleteSnapshot":
				if (!this.snapshots.delete(params.SnapshotId as string)) {
					return error(400, "InvalidSnapshot.NotFound", "no such snapshot");
				}
				return xml(action, { return: true });
			case "DescribeKeyPairs": {
				const name = list(params, "KeyName")[0] as string;
				const key = this.keys.get(name);
				return key === undefined
					? error(
							400,
							"InvalidKeyPair.NotFound",
							`The key pair '${name}' does not exist`,
						)
					: xml(action, {
							keySet: [{ keyName: name, tagSet: tagXml(key.tags) }],
						});
			}
			case "ImportKeyPair":
				this.keys.set(params.KeyName as string, {
					tags: Object.assign({}, ...tagSpecs(params, "key-pair")),
				});
				return xml(action, { keyName: params.KeyName });
			case "DeleteKeyPair":
				this.keys.delete(params.KeyName as string);
				return xml(action, { return: true });
			case "DescribeSubnets": {
				const asked =
					filters(params).find((each) => each.name === "tag-key")?.values ?? [];
				return xml(action, {
					subnetSet:
						this.subnetTagged && asked.includes("splates-worker-subnet")
							? [{ subnetId: this.subnetId, vpcId: this.vpcId }]
							: [],
				});
			}
			case "DescribeSecurityGroups": {
				const found = [...this.groups.values()].filter((group) =>
					matches(filters(params), (name) =>
						name === "group-name"
							? [group.name]
							: name === "vpc-id"
								? [group.vpcId]
								: [],
					),
				);
				return xml(action, {
					securityGroupInfo: found.map((group) => ({
						groupId: group.id,
						ipPermissions: group.rules.map((rule) => ({
							ipProtocol: rule.protocol,
							fromPort: rule.from,
							toPort: rule.to,
							ipRanges: rule.source.includes(":")
								? []
								: [{ cidrIp: rule.source }],
							ipv6Ranges: rule.source.includes(":")
								? [{ cidrIpv6: rule.source }]
								: [],
						})),
					})),
				});
			}
			case "CreateSecurityGroup": {
				const id = `sg-${this.next++}`;
				this.groups.set(id, {
					id,
					name: params.GroupName as string,
					vpcId: params.VpcId as string,
					rules: [],
				});
				return xml(action, { groupId: id });
			}
			case "AuthorizeSecurityGroupIngress":
			case "RevokeSecurityGroupIngress": {
				const group = this.groups.get(params.GroupId as string);
				if (group === undefined) {
					return error(400, "InvalidGroup.NotFound", "no such group");
				}
				for (
					let num = 1;
					params[`IpPermissions.${num}.IpProtocol`] !== undefined;
					num++
				) {
					const prefix = `IpPermissions.${num}`;
					const rule = {
						protocol: params[`${prefix}.IpProtocol`] as string,
						from: Number(params[`${prefix}.FromPort`]),
						to: Number(params[`${prefix}.ToPort`]),
						source: (params[`${prefix}.IpRanges.1.CidrIp`] ??
							params[`${prefix}.Ipv6Ranges.1.CidrIpv6`]) as string,
					};
					group.rules =
						action === "AuthorizeSecurityGroupIngress"
							? [...group.rules, rule]
							: group.rules.filter(
									(each) => JSON.stringify(each) !== JSON.stringify(rule),
								);
				}
				return xml(action, { return: true });
			}
			case "DeleteSecurityGroup":
				if (!this.groups.delete(params.GroupId as string)) {
					return error(400, "InvalidGroup.NotFound", "no such group");
				}
				return xml(action, { return: true });
			default:
				return error(400, "InvalidAction", `FakeAws does not know ${action}`);
		}
	}

	private dlm(method: string, url: URL, body: string | null): Response {
		this.requests.push({
			service: "dlm",
			action: `${method} ${url.pathname}`,
			params: {},
		});
		if (method === "POST") {
			this.policies.push(JSON.parse(body as string));
			return Response.json({ PolicyId: `policy-${this.policies.length}` });
		}
		return Response.json({
			Policies: this.policies.map((_, i) => ({ PolicyId: `policy-${i + 1}` })),
		});
	}
}

/** The values of `prefix.1`, `prefix.2` and so on. */
function list(params: Record<string, string>, prefix: string): string[] {
	const values: string[] = [];
	for (let num = 1; params[`${prefix}.${num}`] !== undefined; num++) {
		values.push(params[`${prefix}.${num}`] as string);
	}
	return values;
}

function filters(
	params: Record<string, string>,
): { name: string; values: string[] }[] {
	const found: { name: string; values: string[] }[] = [];
	for (let num = 1; params[`Filter.${num}.Name`] !== undefined; num++) {
		found.push({
			name: params[`Filter.${num}.Name`] as string,
			values: list(params, `Filter.${num}.Value`),
		});
	}
	return found;
}

function matches(
	asked: { name: string; values: string[] }[],
	get: (name: string) => string[],
): boolean {
	return asked.every(({ name, values }) => {
		const have = get(name);
		return values.some((value) =>
			have.some((each) =>
				new RegExp(`^${value.split("*").map(escaped).join(".*")}$`).test(each),
			),
		);
	});
}

function escaped(text: string): string {
	return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** What a tag filter `tag:K` or `tag-key` sees of `tags`. */
function tagValues(tags: Record<string, string>, name: string): string[] {
	if (name === "tag-key") {
		return Object.keys(tags);
	}
	const key = name.replace(/^tag:/, "");
	return key in tags ? [tags[key] as string] : [];
}

function tagPairs(
	params: Record<string, string>,
	prefix: string,
): Record<string, string> {
	const pairs: Record<string, string> = {};
	for (let num = 1; params[`${prefix}.${num}.Key`] !== undefined; num++) {
		pairs[params[`${prefix}.${num}.Key`] as string] = params[
			`${prefix}.${num}.Value`
		] as string;
	}
	return pairs;
}

/** The tags of each tag specification for `resource`. */
function tagSpecs(
	params: Record<string, string>,
	resource: string,
): Record<string, string>[] {
	const specs: Record<string, string>[] = [];
	for (
		let num = 1;
		params[`TagSpecification.${num}.ResourceType`] !== undefined;
		num++
	) {
		if (params[`TagSpecification.${num}.ResourceType`] === resource) {
			specs.push(tagPairs(params, `TagSpecification.${num}.Tag`));
		}
	}
	return specs;
}

function tagXml(tags: Record<string, string>): Fields[] {
	return Object.entries(tags).map(([key, value]) => ({ key, value }));
}

function instanceXml(instance: FakeInstance): Fields {
	return {
		instanceId: instance.id,
		instanceState: { name: instance.state },
		instanceType: instance.type,
		placement: { availabilityZone: instance.zone },
		...(instance.ip === null ? {} : { ipAddress: instance.ip }),
		launchTime: instance.launchedAt,
		tagSet: tagXml(instance.tags),
	};
}

function error(status: number, code: string, message: string): Response {
	return new Response(
		`<Response><Errors><Error><Code>${code}</Code><Message>${message}</Message></Error></Errors></Response>`,
		{ status },
	);
}

function xml(action: string, fields: Fields): Response {
	return new Response(
		`<?xml version="1.0"?><${action}Response>${nodes(fields)}</${action}Response>`,
	);
}

function nodes(fields: Fields): string {
	return Object.entries(fields)
		.map(([name, value]) => `<${name}>${content(value)}</${name}>`)
		.join("");
}

function content(value: unknown): string {
	if (Array.isArray(value)) {
		return value.map((each) => `<item>${content(each)}</item>`).join("");
	}
	if (typeof value === "object" && value !== null) {
		return nodes(value as Fields);
	}
	return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
