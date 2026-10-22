import type {
	CloudMachine,
	CloudProvider,
	CloudSize,
	NewMachine,
} from "../cloud";

/** A cloud in memory, for tests: what it makes starts booting, for the test to boot. */
export class FakeCloud implements CloudProvider {
	readonly name = "FakeCloud";
	readonly configSource = "new FakeCloud()";
	readonly billing = "fake";
	readonly token = { cred: "FAKE_TOKEN", label: "", help: "", refused: "" };
	readonly defaults = {
		workerLocations: ["nyc3"],
		builderTypes: [],
		image: "ubuntu",
	};
	readonly made: NewMachine[] = [];
	readonly machinesById = new Map<string, CloudMachine>();
	private next = 1;

	constructor(private readonly sizesSold: CloudSize[]) {}

	async accepted(): Promise<boolean> {
		return true;
	}
	async sizes(): Promise<CloudSize[]> {
		return this.sizesSold;
	}
	async machine(id: string): Promise<CloudMachine | null> {
		return this.machinesById.get(id) ?? null;
	}
	async machines(tag: string): Promise<CloudMachine[]> {
		return [...this.machinesById.values()].filter((each) => tag in each.tags);
	}
	async create(spec: NewMachine): Promise<CloudMachine> {
		this.made.push(spec);
		const machine: CloudMachine = {
			id: String(this.next++),
			name: spec.name,
			status: "starting",
			type: spec.type,
			location: spec.location,
			ipv4: null,
			tags: spec.tags,
			createdAt: Date.now(),
		};
		this.machinesById.set(machine.id, machine);
		return machine;
	}
	async delete(id: string): Promise<void> {
		this.machinesById.delete(id);
	}
	async snapshot(): Promise<string> {
		return "snap";
	}
	async snapshots(): Promise<string[]> {
		return [];
	}
	async snapshotCosts() {
		return [];
	}
	async deleteSnapshot(): Promise<void> {}
}

/** A size sold in nyc3 alone. */
export function cloudSize(
	name: string,
	cpus: number,
	memory: number,
	price: number,
): CloudSize {
	return {
		name,
		cpus,
		memory,
		disk: 80,
		dedicated: false,
		dollarsPerHour: price,
		billing: "second",
		locations: new Set(["nyc3"]),
	};
}
