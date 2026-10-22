import type { CloudDefaults, CloudSize } from "../cloud";

/** What a heavy job needs of a runner, or what a runner has: CPUs, and memory in GB. */
export interface JobSize {
	cpus: number;
	/** In GB, fractions allowed. */
	memory: number;
}

/**
 * What a job asks for when its project's `splates.config.ts` sets no `job`:
 * a runner's 4 vCPU and 8 GB, one test run of about 7 cores and 7 GB.
 */
export const DEFAULT_JOB_SIZE: JobSize = { cpus: 4, memory: 8 };

/**
 * What a project's `splates.config.ts` sets as `job`: memory as GB or a size
 * such as `"8GB"`, and `timeout` as minutes or a length such as `"90s"`.
 */
export interface JobSetting {
	cpus?: number;
	memory?: number | string;
	timeout?: number | string;
}

/**
 * `text` as GB: `8`, `8g`, `8GB`, `512MB`, `0.5GiB`. Binary and decimal
 * units alike, since a job's need is rough. Null for anything else.
 */
export function parseMemory(text: string): number | null {
	const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(text);
	const scale = UNITS[match?.[2]?.toLowerCase() ?? "?"];
	if (match?.[1] === undefined || scale === undefined) {
		return null;
	}
	const gb = Number(match[1]) * scale;
	return gb > 0 ? gb : null;
}

/**
 * The size a job asks for: `override`'s where it says, else `setting`'s,
 * else the default. Throws on a memory that is no size.
 */
export function jobSize(
	setting: JobSetting | undefined,
	override: Partial<JobSize> = {},
): JobSize {
	const memory = setting?.memory;
	const set =
		typeof memory === "string"
			? (parseMemory(memory) ??
				invalid(`splates.config.ts sets job.memory to "${memory}"`))
			: memory;
	return {
		cpus: override.cpus ?? setting?.cpus ?? DEFAULT_JOB_SIZE.cpus,
		memory: override.memory ?? set ?? DEFAULT_JOB_SIZE.memory,
	};
}

/**
 * The CPUs and memory a runner said it has in its hello; one from before
 * runners said is taken as the size they were all made as.
 */
export function runnerSize(info: { [key: string]: unknown }): JobSize {
	const { cpus, memory } = info;
	return typeof cpus === "number" && typeof memory === "number"
		? { cpus, memory }
		: DEFAULT_JOB_SIZE;
}

/** Whether a job of `size` fits in `room`. */
export function fits(size: JobSize, room: JobSize): boolean {
	return size.cpus <= room.cpus && size.memory <= room.memory;
}

/**
 * A runner's size as people read it, with its price when given:
 * "4 CPUs, 8 GB, $0.07/h".
 */
export function sizeLabel(size: JobSize, dollarsPerHour?: number): string {
	const cpus = `${size.cpus} ${size.cpus === 1 ? "CPU" : "CPUs"}`;
	const memory = `${Number(size.memory.toFixed(1))} GB`;
	return dollarsPerHour === undefined
		? `${cpus}, ${memory}`
		: `${cpus}, ${memory}, $${dollarsPerHour.toFixed(2)}/h`;
}

const UNITS: Record<string, number> = {
	"": 1,
	g: 1,
	gb: 1,
	gib: 1,
	m: 1 / 1024,
	mb: 1 / 1024,
	mib: 1 / 1024,
	t: 1024,
	tb: 1024,
	tib: 1024,
};

function invalid(what: string): never {
	throw new Error(`${what}: name a size such as "8GB" or "512MB"`);
}

/** The most CPUs a runner is made with, however big a job asks. */
export const MAX_RUNNER_CPUS = 16;

/**
 * The sizes a runner for a job of `job` is made of, the cheapest first:
 * each `sizes` holds that holds the job, up to `MAX_RUNNER_CPUS`, with a disk
 * that boots the snapshot (the smallest of the cloud's builders'), that
 * some location stocks, leaving out those `refused` names.
 */
export function runnerSizes(
	sizes: readonly CloudSize[],
	defaults: CloudDefaults,
	job: JobSize,
	refused: (name: string) => boolean = () => false,
): CloudSize[] {
	const builders = sizes.filter((size) =>
		defaults.builderTypes.includes(size.name),
	);
	const disk = Math.min(...builders.map((size) => size.disk), Infinity);
	return sizes
		.filter(
			(size) =>
				size.cpus <= MAX_RUNNER_CPUS &&
				fits(job, size) &&
				(builders.length === 0 || size.disk >= disk) &&
				!refused(size.name) &&
				locationOf(size, defaults) !== null,
		)
		.sort((one, other) => one.dollarsPerHour - other.dollarsPerHour);
}

/**
 * Where a machine of `size` is made: the first of the cloud's worker
 * locations that stocks it, else the first other that does, by name; null
 * when none does.
 */
export function locationOf(
	size: CloudSize | undefined,
	defaults: CloudDefaults,
): string | null {
	const at = [...(size?.locations ?? [])];
	return (
		defaults.workerLocations.find((location) => at.includes(location)) ??
		at.sort()[0] ??
		null
	);
}
