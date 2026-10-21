import { createHash } from "node:crypto";
import {
	type Duration,
	SystemWallClock,
	sleep,
	type WallClock,
} from "webappwiz/time";

import {
	AwsApi,
	AwsError,
	type AwsInstance,
	awsRules,
	type NewInstance,
} from "./aws-api";
import { AwsCredentialSource } from "./aws-credentials";
import type {
	CloudDefaults,
	CloudMachine,
	CloudProvider,
	FirewallRule,
	NewMachine,
	SnapshotOptions,
} from "./provider";

/**
 * AWS, in the user's own account: EC2 instances, security groups, AMIs and
 * key pairs, signed with whatever credentials the AWS CLI would use, or the
 * instance role on an EC2 box, so splates keeps no AWS key of its own. Tags
 * are EC2's. Name it in `splates.config.ts` for the project's workers:
 *
 * ```ts
 * import { AwsCloud } from "@stringsync/splates-server/cloud";
 *
 * export default { cloud: new AwsCloud() } satisfies ConfigFile;
 * ```
 *
 * Workers go in the subnet tagged `splates-worker-subnet` and run as the
 * instance profile named `splates-worker`, both of which the stack made.
 */
export class AwsCloud implements CloudProvider {
	readonly name = "AWS";
	readonly configSource = "new AwsCloud()";
	/** AWS has no token of splates's own: the CLI's sign-in, or the instance role, is read. */
	readonly token = null;
	readonly defaults: CloudDefaults;
	private readonly source: AwsCredentialSource;
	private readonly region: string;
	private readonly profile: string;
	private readonly diskGb: number;
	private readonly backupRole: string;
	private readonly wall: WallClock;
	private readonly wait: (duration: Duration) => Promise<void>;
	private readonly fetch: typeof globalThis.fetch | undefined;

	constructor(opts: AwsCloudOptions = {}) {
		this.source = opts.credentials ?? new AwsCredentialSource();
		this.region = opts.region ?? this.source.region();
		this.profile = opts.profile ?? WORKER_PROFILE;
		this.diskGb = opts.diskGb ?? DISK_GB;
		this.backupRole = opts.backupRole ?? BACKUP_ROLE;
		this.wall = opts.wall ?? new SystemWallClock();
		this.wait = opts.wait ?? sleep;
		this.fetch = opts.fetch;
		this.defaults = {
			...AWS_DEFAULTS,
			workerLocations: [this.region],
			box: { ...AWS_DEFAULTS.box, locations: [this.region] },
		};
	}

	async accepted(): Promise<boolean> {
		return this.api().accepted();
	}

	async orderable(): Promise<Map<string, Set<string>>> {
		const { defaults } = this;
		const types = [
			...defaults.workerTypes.map((type) => type.name),
			...defaults.builderTypes,
			defaults.box.type,
		];
		const offered = await this.api().offered(types);
		return new Map([...offered].map((type) => [type, new Set([this.region])]));
	}

	async machine(id: string): Promise<CloudMachine | null> {
		const found = await this.api().instance(id);
		return found === null ? null : this.machineOf(found);
	}

	async machines(tag: string, value?: string): Promise<CloudMachine[]> {
		return (await this.api().taggedInstances(tag, value)).map((each) =>
			this.machineOf(each),
		);
	}

	async create(spec: NewMachine): Promise<CloudMachine> {
		if (spec.location !== this.region) {
			throw new Error(
				`AWS here makes machines in ${this.region}, not ${spec.location}`,
			);
		}
		const api = this.api();
		const subnet = await this.subnet(api);
		const image = await this.imageId(api, spec.image);
		const instance: NewInstance = {
			imageId: image,
			rootDevice: ROOT_DEVICE,
			diskGb: this.diskGb,
			type: spec.type,
			userData: spec.userData,
			subnetId: subnet.id,
			securityGroupIds: spec.firewalls ?? [],
			profile: this.profile,
			tags: { ...spec.tags, Name: spec.name },
			...(spec.sshKeys?.[0] === undefined ? {} : { keyName: spec.sshKeys[0] }),
		};
		if (spec.spot !== true) {
			return this.machineOf(await api.runInstance(instance));
		}
		try {
			return this.machineOf(await api.runInstance({ ...instance, spot: true }));
		} catch (error) {
			if (!(error instanceof AwsError && NO_SPOT.has(error.code))) {
				throw error;
			}
			return this.machineOf(await api.runInstance(instance));
		}
	}

	async delete(id: string): Promise<void> {
		await this.api().terminate(id);
	}

	async protect(id: string, on: boolean): Promise<void> {
		const api = this.api();
		await api.protect(id, on);
		await api.tag([id], { [PROTECTED_TAG]: String(on) });
	}

	async enableBackups(id: string): Promise<void> {
		const api = this.api();
		await api.tag([id], { [BACKUP_TAG]: BACKUP_VALUE });
		await api.ensureDailyBackups(BACKUP_TAG, BACKUP_VALUE, this.backupRole);
	}

	async snapshot(id: string, opts: SnapshotOptions): Promise<string> {
		// An AMI's name must be unique and takes no spaces.
		const name = `${opts.description.replace(/[^A-Za-z0-9()./_-]+/g, "-")}-${this.wall.now()}`;
		return this.api().createImage(id, name, opts.description, opts.tags);
	}

	async snapshots(tag: string, value?: string): Promise<string[]> {
		return this.api().taggedImages(tag, value);
	}

	async deleteSnapshot(id: string): Promise<void> {
		await this.api().deleteImage(id);
	}

	async ensureSshKey(name: string, publicKey: string): Promise<string> {
		const api = this.api();
		const fingerprint = createHash("sha256")
			.update(publicKey.trim())
			.digest("hex");
		const key = await api.keyPair(name);
		if (key?.tags[KEY_TAG] === fingerprint) {
			return name;
		}
		if (key !== null) {
			await api.deleteKeyPair(name);
		}
		await api.importKeyPair(name, publicKey.trim(), { [KEY_TAG]: fingerprint });
		return name;
	}

	async removeSshKey(name: string): Promise<void> {
		await this.api().deleteKeyPair(name);
	}

	async ensureFirewall(name: string, rules: FirewallRule[]): Promise<string> {
		const api = this.api();
		const { vpcId } = await this.subnet(api);
		const group = await api.securityGroup(name, vpcId);
		const wanted = awsRules(rules);
		if (group === null) {
			const id = await api.createSecurityGroup(name, vpcId);
			await api.changeRules(id, wanted, true);
			return id;
		}
		const key = (rule: {
			protocol: string;
			from: number;
			to: number;
			source: string;
		}) => `${rule.protocol} ${rule.from} ${rule.to} ${rule.source}`;
		const have = new Set(group.rules.map(key));
		const want = new Set(wanted.map(key));
		// New rules first, so a rule that stays never has a gap.
		await api.changeRules(
			group.id,
			wanted.filter((rule) => !have.has(key(rule))),
			true,
		);
		await api.changeRules(
			group.id,
			group.rules.filter((rule) => !want.has(key(rule))),
			false,
		);
		return group.id;
	}

	async removeFirewall(name: string): Promise<void> {
		const api = this.api();
		const subnet = await api.subnet(WORKER_SUBNET_TAG);
		const group =
			subnet === null ? null : await api.securityGroup(name, subnet.vpcId);
		if (group !== null) {
			await api.deleteSecurityGroup(group.id);
		}
	}

	private api(): AwsApi {
		return new AwsApi(this.source, this.region, {
			wall: this.wall,
			wait: this.wait,
			...(this.fetch === undefined ? {} : { fetch: this.fetch }),
		});
	}

	private async subnet(api: AwsApi): Promise<{ id: string; vpcId: string }> {
		const subnet = await api.subnet(WORKER_SUBNET_TAG);
		if (subnet === null) {
			throw new Error(
				`no subnet in ${this.region} is tagged ${WORKER_SUBNET_TAG}: deploy the splates stack there first`,
			);
		}
		return subnet;
	}

	/** An AMI's id as it stands, or the newest Ubuntu one for a name such as `ubuntu-24.04`. */
	private async imageId(api: AwsApi, image: string): Promise<string> {
		if (image.startsWith("ami-")) {
			return image;
		}
		const found = await api.newestImage(
			CANONICAL,
			`ubuntu/images/hvm-ssd-gp3/ubuntu-${UBUNTU[image] ?? image}-amd64-server-*`,
		);
		if (found === null) {
			throw new Error(`AWS has no image '${image}' in ${this.region}`);
		}
		return found;
	}

	private machineOf(instance: AwsInstance): CloudMachine {
		const {
			[PROTECTED_TAG]: guarded,
			[BACKUP_TAG]: backed,
			Name,
			...tags
		} = instance.tags;
		return {
			id: instance.id,
			name: Name ?? instance.id,
			status: STATUS[instance.state] ?? instance.state,
			type: instance.type,
			location: this.region,
			ipv4: instance.ipv4,
			tags,
			protected: guarded === "true",
			backups: backed === BACKUP_VALUE,
			createdAt: instance.launchedAt,
			spot: instance.spot,
		};
	}
}

/** What an `AwsCloud` runs on; the real ones by default. */
export interface AwsCloudOptions {
	/** The region it works in; `AWS_REGION`, else us-east-1, by default. */
	region?: string;
	/** Where credentials come from; the environment, the AWS CLI, then the instance role. */
	credentials?: AwsCredentialSource;
	/** The instance profile workers run as; `splates-worker` by default. */
	profile?: string;
	/** The root disk of each machine, in GB; 50 by default. */
	diskGb?: number;
	/** The role Data Lifecycle Manager makes backups as; `AWSDataLifecycleManagerDefaultRole` by default. */
	backupRole?: string;
	fetch?: typeof globalThis.fetch;
	wall?: WallClock;
	/** How it waits between looks at an image being made. */
	wait?: (duration: Duration) => Promise<void>;
}

/** The tag of the public subnet the stack made, where workers go. */
export const WORKER_SUBNET_TAG = "splates-worker-subnet";

/** What EC2 answers a spot request with when it has none to give; an on-demand machine is asked for instead. */
const NO_SPOT = new Set([
	"InsufficientInstanceCapacity",
	"SpotMaxPriceTooLow",
	"MaxSpotInstanceCountExceeded",
	"InsufficientFreeAddressesInSubnet",
	"Unsupported",
	"SpotInstanceRequestLimitExceeded",
]);

const WORKER_PROFILE = "splates-worker";
const BACKUP_ROLE = "AWSDataLifecycleManagerDefaultRole";
const DISK_GB = 50;
const ROOT_DEVICE = "/dev/sda1";

/** The tags that stand for what an instance's own record lacks: its protection and its backups. */
const PROTECTED_TAG = "splates-protected";
const BACKUP_TAG = "splates-backup";
const BACKUP_VALUE = "daily";

/** The tag that holds which public key a key pair was imported from, since AWS keeps only a fingerprint. */
const KEY_TAG = "splates-public-key";

/** Canonical's AWS account, which owns the Ubuntu images. */
const CANONICAL = "099720109477";
const UBUNTU: Record<string, string> = { "ubuntu-24.04": "noble-24.04" };

const STATUS: Record<string, string> = {
	pending: "starting",
	stopped: "off",
};

/**
 * What splates makes in AWS, in us-east-1. Prices are On-Demand list prices
 * for Linux there, in US dollars, billed by the second after the first
 * minute; each worker's public IPv4 adds $0.005 an hour.
 */
export const AWS_DEFAULTS: CloudDefaults = {
	spot: true,
	workerTypes: [
		// 4 vCPU and 16 GB: four slots of 4 GB.
		{
			name: "m7i.xlarge",
			platform: "linux",
			slots: 4,
			dollarsPerHour: 0.2016,
			// Typical m7i.xlarge spot price in us-east-1, about 40% of on demand.
			spotDollarsPerHour: 0.08,
			billing: "second",
		},
	],
	workerLocations: ["us-east-1"],
	builderTypes: ["t3.medium", "t3a.medium"],
	image: "ubuntu-24.04",
	box: {
		// 2 vCPU and 4 GB, as the CPX21 it replaces: about $30 a month, its
		// disk and daily snapshots and public IPv4 the rest of $38.
		type: "t3.medium",
		locations: ["us-east-1"],
		about:
			"an AWS t3.medium in us-east-1 with daily snapshots of its disk: about $38 a month",
	},
};
