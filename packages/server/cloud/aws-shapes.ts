import type { Duration, WallClock } from "webappwiz/time";
import { AwsXml, type XmlValue } from "./aws-xml";
import type { FirewallRule } from "./provider";

/** An instance as AWS has it. */
export interface AwsInstance {
	id: string;
	/** AWS's own state name: pending, running, stopping or stopped. */
	state: string;
	type: string;
	zone: string;
	ipv4: string | null;
	tags: Record<string, string>;
	/** When it launched, epoch milliseconds. */
	launchedAt: number;
	/** Whether it is a spot instance. */
	spot: boolean;
}

/** What `AwsApi.runInstance` makes. */
export interface NewInstance {
	imageId: string;
	/** The image's root device, as `/dev/sda1`, which `diskGb` sizes. */
	rootDevice: string;
	diskGb: number;
	type: string;
	userData: string;
	subnetId: string;
	securityGroupIds: string[];
	keyName?: string;
	/** The instance profile's name. */
	profile?: string;
	tags: Record<string, string>;
	/** Asks for a one-time spot instance, terminated when AWS takes it back. */
	spot?: boolean;
}

/** A security group and its inbound rules, one per source. */
export interface AwsSecurityGroup {
	id: string;
	rules: AwsRule[];
}

/** One inbound rule, from one source; `from` and `to` are -1 for icmp. */
export interface AwsRule {
	protocol: string;
	from: number;
	to: number;
	source: string;
}

/** The rules `rules` asks, one for each source and each port in its range. */
export function awsRules(rules: FirewallRule[]): AwsRule[] {
	return rules.flatMap((rule) => {
		const [from, to] = portRange(rule);
		return rule.sourceIps.map((source) => ({
			protocol: rule.protocol,
			from,
			to,
			source: source.includes("/")
				? source
				: `${source}/${source.includes(":") ? 128 : 32}`,
		}));
	});
}

function portRange(rule: FirewallRule): [number, number] {
	if (rule.protocol === "icmp") {
		return [-1, -1];
	}
	const [from, to] = rule.port.split("-").map(Number);
	return [from ?? 0, to ?? from ?? 0];
}

export function tagsOf(set: XmlValue | undefined): Record<string, string> {
	return Object.fromEntries(
		AwsXml.list(set).map((each) => [
			AwsXml.str(AwsXml.field(each, "key")),
			AwsXml.str(AwsXml.field(each, "value")),
		]),
	);
}

export function instanceOf(value: XmlValue | undefined): AwsInstance {
	const ip = AwsXml.str(AwsXml.field(value, "ipAddress"));
	return {
		id: AwsXml.str(AwsXml.field(value, "instanceId")),
		state: AwsXml.str(
			AwsXml.field(AwsXml.field(value, "instanceState"), "name"),
		),
		type: AwsXml.str(AwsXml.field(value, "instanceType")),
		zone: AwsXml.str(
			AwsXml.field(AwsXml.field(value, "placement"), "availabilityZone"),
		),
		ipv4: ip === "" ? null : ip,
		tags: tagsOf(AwsXml.field(value, "tagSet")),
		launchedAt: Date.parse(AwsXml.str(AwsXml.field(value, "launchTime"))),
		spot: AwsXml.str(AwsXml.field(value, "instanceLifecycle")) === "spot",
	};
}

/** The rules of one `ipPermissions` item, one per range. */
export function rulesOf(permission: XmlValue): AwsRule[] {
	const protocol = AwsXml.str(AwsXml.field(permission, "ipProtocol"));
	const from = Number(AwsXml.str(AwsXml.field(permission, "fromPort")) || -1);
	const to = Number(AwsXml.str(AwsXml.field(permission, "toPort")) || -1);
	const sources = [
		...AwsXml.list(AwsXml.field(permission, "ipRanges")).map((each) =>
			AwsXml.str(AwsXml.field(each, "cidrIp")),
		),
		...AwsXml.list(AwsXml.field(permission, "ipv6Ranges")).map((each) =>
			AwsXml.str(AwsXml.field(each, "cidrIpv6")),
		),
	];
	return sources.map((source) => ({ protocol, from, to, source }));
}

export function tagFilter(
	tag: string,
	value: string | undefined,
): { Name: string; Value: string[] } {
	return value === undefined
		? { Name: "tag-key", Value: [tag] }
		: { Name: `tag:${tag}`, Value: [value] };
}

export function tagList(
	tags: Record<string, string>,
): { Key: string; Value: string }[] {
	return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

/** `params` as the Query API's flat pairs: arrays number from 1 and objects nest with dots. */
export function* flatten(
	params: unknown,
	prefix = "",
): Generator<[string, string]> {
	if (Array.isArray(params)) {
		for (const [index, each] of params.entries()) {
			yield* flatten(each, `${prefix}.${index + 1}`);
		}
	} else if (typeof params === "object" && params !== null) {
		for (const [key, each] of Object.entries(params)) {
			yield* flatten(each, prefix === "" ? key : `${prefix}.${key}`);
		}
	} else {
		yield [prefix, String(params)];
	}
}

/** What an `AwsApi` runs on; the real ones by default. */
export interface AwsApiOptions {
	fetch?: typeof globalThis.fetch;
	wall?: WallClock;
	/** How it waits between looks at an image being made. */
	wait?: (duration: Duration) => Promise<void>;
}

export interface AwsImage {
	id: string;
	state: string;
	snapshots: string[];
}

export type Params = Record<string, unknown>;

/** The `RunInstances` parameters for `spec`. */
export function runParams(spec: NewInstance): Params {
	return {
		ImageId: spec.imageId,
		InstanceType: spec.type,
		MinCount: 1,
		MaxCount: 1,
		UserData: Buffer.from(spec.userData).toString("base64"),
		InstanceInitiatedShutdownBehavior:
			spec.spot === true ? "terminate" : "stop",
		MetadataOptions: { HttpTokens: "required", HttpEndpoint: "enabled" },
		BlockDeviceMapping: [
			{
				DeviceName: spec.rootDevice,
				Ebs: {
					VolumeSize: spec.diskGb,
					VolumeType: "gp3",
					DeleteOnTermination: true,
				},
			},
		],
		NetworkInterface: [
			{
				DeviceIndex: 0,
				SubnetId: spec.subnetId,
				AssociatePublicIpAddress: true,
				SecurityGroupId: spec.securityGroupIds,
			},
		],
		...(spec.spot === true
			? {
					InstanceMarketOptions: {
						MarketType: "spot",
						SpotOptions: {
							SpotInstanceType: "one-time",
							InstanceInterruptionBehavior: "terminate",
						},
					},
				}
			: {}),
		...(spec.keyName === undefined ? {} : { KeyName: spec.keyName }),
		...(spec.profile === undefined
			? {}
			: { IamInstanceProfile: { Name: spec.profile } }),
		TagSpecification: ["instance", "volume"].map((type) => ({
			ResourceType: type,
			Tag: tagList(spec.tags),
		})),
	};
}
