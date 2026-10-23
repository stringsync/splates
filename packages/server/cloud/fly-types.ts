/** A Fly machine retains its id across stop and start. */
export interface FlyMachine {
	id: string;
	name: string;
	state: FlyState;
	region: string;
	config: FlyMachineConfig;
	created_at: string;
}

export type FlyState =
	| "created"
	| "starting"
	| "started"
	| "stopping"
	| "stopped"
	| "destroying"
	| "destroyed"
	| "suspended";

/** The CPU preset and RAM are independent choices in Fly's API. */
export interface FlySize {
	name: string;
	preset: string;
	cpus: number;
	memory: number;
	cpuKind: "shared" | "performance";
	dollarsPerHour: number;
	billing: "second";
}

export interface FlyService {
	protocol: "tcp" | "udp";
	internal_port: number;
	ports?: { port: number; handlers?: string[] }[];
	autostart?: boolean;
	autostop?: "off" | "stop" | "suspend";
	concurrency?: {
		type: "connections" | "requests";
		soft_limit: number;
		hard_limit: number;
	};
}

export interface FlyMachineConfig {
	image: string;
	env: Record<string, string>;
	init?: { cmd?: string[]; entrypoint?: string[] };
	metadata: Record<string, string>;
	auto_destroy: boolean;
	guest: {
		cpu_kind: "shared" | "performance";
		cpus: number;
		memory_mb: number;
		persist_rootfs?: "never" | "restart" | "always";
	};
	services: FlyService[];
	restart?: { policy: "no" | "always" | "on-failure" };
}

export interface NewFlyMachine {
	name?: string;
	size: FlySize;
	region: string;
	image: string;
	/** The machine's environment, which holds its secret: kept out of every log. */
	env: Record<string, string>;
	cmd?: string[];
	/** Run in place of the image's entrypoint. */
	entrypoint?: string[];
	metadata: Record<string, string>;
	autoDestroy: boolean;
	persistRootfs: "never" | "restart" | "always";
	services: FlyService[];
}

/** The Fly lifecycle used by runners, with no snapshot or public-IP abstraction. */
export interface FlyMachines {
	sizes(): Promise<FlySize[]>;
	create(spec: NewFlyMachine): Promise<FlyMachine>;
	machine(id: string): Promise<FlyMachine | null>;
	list(metadata?: Record<string, string>): Promise<FlyMachine[]>;
	start(id: string): Promise<void>;
	stop(id: string): Promise<void>;
	destroy(id: string): Promise<void>;
	wait(id: string, state: FlyState): Promise<void>;
}
