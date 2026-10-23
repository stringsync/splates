import { FLY_SIZES } from "./fly-sizes";
import type {
	FlyMachine,
	FlyMachines,
	FlySize,
	FlyState,
	NewFlyMachine,
} from "./fly-types";
import { TypeRefused } from "./provider";

/** Fly's lifecycle without network or a clock: advance() completes pending transitions. */
export class FakeFlyCloud implements FlyMachines {
	readonly machines = new Map<string, FlyMachine>();
	readonly files = new Map<string, Map<string, string>>();
	readonly history: { id: string; state: FlyState }[] = [];
	readonly refused = new Set<string>();
	/** Leave transitions pending so a keeper can observe starting and stopping. */
	autoAdvance = true;
	private nextId = 0;

	appExists = false;
	accepted = true;
	readonly ips = new Set<string>();
	readonly requests: { path: string; method: string; body: unknown }[] = [];
	failure: { status: number; reason: string } | undefined;

	/** Exercises the real client against the same lifecycle as direct fake callers. */
	readonly fetch: typeof globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		const url = new URL(input instanceof Request ? input.url : input);
		const method = init?.method ?? "GET";
		const body =
			typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		this.requests.push({ path: url.pathname + url.search, method, body });
		if (!this.accepted) {
			return Response.json({ error: "unauthorized" }, { status: 401 });
		}
		if (this.failure) {
			return Response.json(
				{ error: this.failure.reason },
				{ status: this.failure.status },
			);
		}
		if (url.pathname === "/graphql") {
			if (body.variables.input) {
				this.ips.add(body.variables.input.type);
				return Response.json({
					data: { allocateIpAddress: { app: { name: "runners" } } },
				});
			}
			return Response.json({
				data: {
					app: {
						sharedIpAddress: this.ips.has("shared_v4") ? "shared" : null,
						ipAddresses: { nodes: [...this.ips].map((type) => ({ type })) },
					},
				},
			});
		}
		const parts = url.pathname.split("/");
		if (url.pathname === "/v1/apps") {
			if (method === "POST") {
				this.appExists = true;
			}
			return Response.json({ apps: [] });
		}
		if (!this.appExists) {
			return Response.json({ error: "not found" }, { status: 404 });
		}
		if (parts.length === 4) {
			return Response.json({ name: parts[3] });
		}
		if (parts.length === 5) {
			if (method === "POST") {
				const config = body.config;
				const size = FLY_SIZES.find(
					(size) =>
						size.cpuKind === config.guest.cpu_kind &&
						size.cpus === config.guest.cpus &&
						size.memory * 1024 === config.guest.memory_mb,
				);
				if (!size) {
					return Response.json({ error: "invalid size" }, { status: 422 });
				}
				try {
					return Response.json(
						await this.create({
							name: body.name,
							size,
							region: body.region,
							image: config.image,
							env: config.env,
							cmd: config.init?.cmd,
							metadata: config.metadata,
							autoDestroy: config.auto_destroy,
							persistRootfs: config.guest.persist_rootfs,
							services: config.services,
						}),
					);
				} catch (error) {
					if (error instanceof TypeRefused) {
						return Response.json({ error: error.message }, { status: 503 });
					}
					throw error;
				}
			}
			return Response.json(
				await this.list(
					Object.fromEntries(
						[...url.searchParams]
							.filter(([key]) => key.startsWith("metadata."))
							.map(([key, value]) => [key.slice(9), value]),
					),
				),
			);
		}
		const id = decodeURIComponent(parts[5] ?? "");
		if (parts[6] === "wait") {
			try {
				await this.wait(id, url.searchParams.get("state") as FlyState);
				return Response.json({});
			} catch {
				return Response.json({ error: "timeout" }, { status: 408 });
			}
		}
		if ((await this.machine(id)) === null) {
			return Response.json({ error: "not found" }, { status: 404 });
		}
		if (method === "DELETE") {
			await this.destroy(id);
		} else if (parts[6] === "start") {
			await this.start(id);
		} else if (parts[6] === "stop") {
			await this.stop(id);
		}
		return Response.json(await this.machine(id));
	}) as typeof globalThis.fetch;

	async sizes(): Promise<FlySize[]> {
		return FLY_SIZES.map((size) => ({ ...size }));
	}

	async create(spec: NewFlyMachine): Promise<FlyMachine> {
		if (this.refused.has(spec.size.name)) {
			throw new TypeRefused(spec.size.name, "no capacity");
		}
		const id = `fly-${++this.nextId}`;
		const machine: FlyMachine = {
			id,
			name: spec.name ?? id,
			state: "created",
			region: spec.region,
			created_at: "2026-01-01T00:00:00.000Z",
			config: {
				image: spec.image,
				env: structuredClone(spec.env),
				metadata: structuredClone(spec.metadata),
				auto_destroy: spec.autoDestroy,
				guest: {
					cpu_kind: spec.size.cpuKind,
					cpus: spec.size.cpus,
					memory_mb: spec.size.memory * 1024,
					persist_rootfs: spec.persistRootfs,
				},
				...(spec.cmd === undefined ? {} : { init: { cmd: [...spec.cmd] } }),
				services: structuredClone(spec.services),
				restart: { policy: "no" },
			},
		};
		this.machines.set(id, machine);
		this.files.set(id, new Map());
		this.state(machine, "created");
		this.state(machine, "starting");
		if (this.autoAdvance) {
			this.advance(id);
		}
		return structuredClone(machine);
	}

	async machine(id: string): Promise<FlyMachine | null> {
		const machine = this.machines.get(id);
		return machine === undefined || machine.state === "destroyed"
			? null
			: structuredClone(machine);
	}

	async list(metadata: Record<string, string> = {}): Promise<FlyMachine[]> {
		return [...this.machines.values()]
			.filter(
				(machine) =>
					machine.state !== "destroyed" &&
					Object.entries(metadata).every(
						([key, value]) => machine.config.metadata[key] === value,
					),
			)
			.map((machine) => structuredClone(machine));
	}

	async start(id: string): Promise<void> {
		const machine = this.require(id);
		if (machine.state === "started" || machine.state === "starting") {
			return;
		}
		if (machine.state !== "stopped" && machine.state !== "created") {
			throw new Error(`cannot start ${machine.state} machine`);
		}
		this.state(machine, "starting");
		if (this.autoAdvance) {
			this.advance(id);
		}
	}

	async stop(id: string): Promise<void> {
		const machine = this.require(id);
		if (machine.state === "stopped" || machine.state === "stopping") {
			return;
		}
		this.state(machine, "stopping");
		if (this.autoAdvance) {
			this.advance(id);
		}
	}

	async destroy(id: string): Promise<void> {
		const machine = this.machines.get(id);
		if (!machine || machine.state === "destroyed") {
			return;
		}
		this.state(machine, "destroying");
		this.state(machine, "destroyed");
		this.files.delete(id);
	}

	async wait(id: string, state: FlyState): Promise<void> {
		this.advance(id);
		if (this.machines.get(id)?.state !== state) {
			throw new Error(`Fly wait timed out waiting for ${state}`);
		}
	}

	advance(id: string): void {
		const machine = this.machines.get(id);
		if (!machine) {
			throw new Error(`no machine ${id}`);
		}
		if (machine.state === "starting") {
			this.state(machine, "started");
		}
		if (machine.state === "stopping") {
			this.state(machine, "stopped");
			if (
				!machine.config.guest.persist_rootfs ||
				machine.config.guest.persist_rootfs === "never"
			) {
				this.files.get(id)?.clear();
			}
			if (machine.config.auto_destroy) {
				this.state(machine, "destroyed");
				this.files.delete(id);
			}
		}
	}

	private require(id: string): FlyMachine {
		const machine = this.machines.get(id);
		if (!machine || machine.state === "destroyed") {
			throw new Error(`no machine ${id}`);
		}
		return machine;
	}

	private state(machine: FlyMachine, state: FlyState): void {
		machine.state = state;
		this.history.push({ id: machine.id, state });
	}
}
