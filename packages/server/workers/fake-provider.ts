import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import type {
	ProvisionedMachine,
	Snapshot,
	SnapshotRecipe,
	WorkerProvider,
	WorkerSpec,
	WorkerType,
} from "./provider";

/**
 * A WorkerProvider that makes no machines and remembers what it was asked
 * for, so a test reads the steps back in order; each `create` keeps its
 * spec, boot command and all, for the test to boot by hand.
 */
export class FakeWorkerProvider implements WorkerProvider {
	private readonly calls: string[] = [];
	private readonly machines = new Map<string, ProvisionedMachine>();
	readonly specs: WorkerSpec[] = [];
	/** What its next `sweep` says it deleted. */
	readonly leftovers: string[] = [];
	private built = 0;
	/** How long a worker may be idle before it is destroyed, as a provider that destroys idle ones says. */
	idleAfter: Duration | undefined = Duration.mins(15);
	/** The provider its bill is pulled as; none unless set. */
	billing?: string;

	constructor(
		private readonly offered: WorkerType[] = [
			{
				name: "small",
				platform: "linux",
				slots: 4,
				dollarsPerHour: 0.05,
				billing: "second",
			},
		],
		private readonly wall: WallClock = new SystemWallClock(),
	) {}

	async types(): Promise<WorkerType[]> {
		return this.offered;
	}

	async snapshot(recipe: SnapshotRecipe): Promise<Snapshot> {
		this.built += 1;
		this.calls.push(`snapshot ${recipe.platform} ${recipe.version}`);
		return {
			id: `snap-${this.built}`,
			version: recipe.version,
			builtAt: this.wall.now(),
		};
	}

	async create(spec: WorkerSpec): Promise<ProvisionedMachine> {
		this.calls.push(`create ${spec.id} ${spec.type} ${spec.snapshot}`);
		this.specs.push(spec);
		const machine = { id: spec.id, type: spec.type };
		this.machines.set(spec.id, machine);
		return machine;
	}

	async destroy(id: string): Promise<void> {
		this.calls.push(`destroy ${id}`);
		this.machines.delete(id);
	}

	async list(): Promise<ProvisionedMachine[]> {
		return [...this.machines.values()];
	}

	async sweep(): Promise<string[]> {
		return this.leftovers.splice(0);
	}

	/** Makes a machine as though an earlier run had, without a call. */
	adopt(machine: ProvisionedMachine): void {
		this.machines.set(machine.id, machine);
	}

	getCalls(): string[] {
		return this.calls;
	}
}
