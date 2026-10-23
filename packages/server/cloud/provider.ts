export { TypeRefused } from "../workers";

/**
 * CloudProvider is the seam onto a cloud account splates makes machines in,
 * the user's own, through the cloud's API: the runners a project's
 * `splates.config.ts` turns on with `cloud`. It knows nothing of what
 * splates runs on them; `CloudWorkers` does, over any cloud. Tags are how
 * splates finds what it made: it keeps no state of its own about them.
 */
export interface CloudProvider {
	/** What the user knows it as, as "Fly.io". */
	readonly name: string;
	/**
	 * How a `splates.config.ts` names it as its `cloud`, as
	 * `new FlyCloud()`, imported from `@stringsync/splates-server/cloud`.
	 */
	readonly configSource: string;
	/** The API token it reads from the device's creds, and how the user gets one. */
	readonly token: CloudToken;
	/** What it makes unless told otherwise, and what each costs. */
	readonly defaults: CloudDefaults;
	/** Whether the token it keeps is one its API takes; false without one. */
	accepted(): Promise<boolean>;
	/**
	 * The billing provider its bill is pulled into the spend ledger as, as
	 * `fly`, which each runner's estimate is set beside.
	 */
	readonly billing: string;
	/** Each size it sells that can be ordered now somewhere, with where and what it costs. */
	sizes(): Promise<CloudSize[]>;
	/** Machine `id`, or null when there is none. */
	machine(id: string): Promise<CloudMachine | null>;
	/** The machines tagged `tag`, with `value` when given. */
	machines(tag: string, value?: string): Promise<CloudMachine[]>;
	/**
	 * Makes a machine as `spec` says, answering once it is booting. Throws
	 * `TypeRefused` when the cloud will not make its type for this account,
	 * as a limit its API does not list.
	 */
	create(spec: NewMachine): Promise<CloudMachine>;
	/** Deletes machine `id`; silent when it is already gone. */
	delete(id: string): Promise<void>;
	/** Images machine `id`, which should be off, answering the snapshot's id. */
	snapshot(id: string, opts: SnapshotOptions): Promise<string>;
	/** The ids of the snapshots tagged `tag`, with `value` when given. */
	snapshots(tag: string, value?: string): Promise<string[]>;
	/** What the snapshots tagged `tag`, with `value` when given, cost to keep. */
	snapshotCosts(tag: string, value?: string): Promise<SnapshotCost[]>;
	/** Deletes snapshot `id`; silent when it is already gone. */
	deleteSnapshot(id: string): Promise<void>;
}

/** A size of machine a cloud sells, as its API says now. */
export interface CloudSize {
	/** The cloud's own name for it, which machines are ordered by and the bill names. */
	name: string;
	cpus: number;
	/** In GB. */
	memory: number;
	/** Its disk in GB, which must hold the snapshot it boots. */
	disk: number;
	/** Whether its CPUs are its own, rather than shared with other machines. */
	dedicated: boolean;
	/** What it costs an hour, in US dollars. */
	dollarsPerHour: number;
	/** `"second"` for only the time a machine of it runs, `"hour"` for each started hour. */
	billing: "hour" | "second";
	/** The locations it can be ordered in now. */
	locations: Set<string>;
}

/** The API token a cloud reads, and how the setup page asks for it. */
export interface CloudToken {
	/** The device cred it is kept as, as `FLY_API_TOKEN`. */
	cred: string;
	/** What the setup page labels it. */
	label: string;
	/** Where to get it, in markdown. */
	help: string;
	/** Why a step that needs it is not done, when the cloud refuses it. */
	refused: string;
}

/** What a cloud makes when not told otherwise. */
export interface CloudDefaults {
	/** Where runners go first, in the order tried, before any other location that stocks them. */
	workerLocations: readonly string[];
	/** The sizes a runner snapshot is built on, the first orderable taken; a runner's disk is at least the smallest's. */
	builderTypes: readonly string[];
	/** The image machines start from: Debian or Ubuntu with cloud-init. */
	image: string;
}

/** A machine as a cloud has it. */
export interface CloudMachine {
	id: string;
	name: string;
	/** "running", "starting" or "off", or the cloud's own word for another state. */
	status: string;
	type: string;
	location: string;
	/** Its public IPv4 address, or null while it has none. */
	ipv4: string | null;
	tags: Record<string, string>;
	/** When it was made, epoch milliseconds. */
	createdAt: number;
}

/** What `CloudProvider.create` makes. */
export interface NewMachine {
	name: string;
	type: string;
	/** An image's name, as `CloudDefaults.image`, or a snapshot's id. */
	image: string;
	location: string;
	/** Run once on first boot by cloud-init; may hold secrets, so it goes in no log. */
	userData: string;
	tags: Record<string, string>;
}

/** What it costs to keep one snapshot, as the cloud's API says. */
export interface SnapshotCost {
	id: string;
	gigabytes: number;
	/** In US dollars. */
	dollarsPerMonth: number;
}

/** What `CloudProvider.snapshot` takes. */
export interface SnapshotOptions {
	description: string;
	tags: Record<string, string>;
}
