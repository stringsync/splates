import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import {
	type Evidence,
	type Json,
	matches,
	type Probe,
	type ProbeIsolation,
	type ProbeRun,
} from "./probe";
import { cliAdapter } from "./probe-adapters";
import { type Allowance, admit } from "./probe-affordability";
import {
	assessRun,
	configurationHash,
	hash,
	type ProbeModule,
	type RunContext,
	type RunOptions,
	type Seed,
	type StoredRun,
	saveResult,
	type Target,
	validate,
} from "./probe-record";
import { eventSchema } from "./probe-schema";

export type {
	Adapter,
	ProbeModule,
	RunContext,
	RunOptions,
	Seed,
	StoredRun,
	Target,
} from "./probe-record";
export {
	assessRun,
	configurationHash,
	hash,
	readRun,
	validate,
} from "./probe-record";

/** All combinations get an outcome, including those cancelled before they start. */
export async function runProbes(
	module: ProbeModule,
	targets: Target[],
	opts: RunOptions,
): Promise<StoredRun[]> {
	validate(module.probes);
	for (const count of [opts.parallel, opts.reps]) {
		if (!Number.isSafeInteger(count) || count < 1) {
			throw new Error("parallel and reps must be positive integers");
		}
	}
	const seedIds = module.seeds.map((seed) => `${seed.id}@${seed.version}`);
	if (new Set(seedIds).size !== seedIds.length) {
		throw new Error("duplicate seed handler");
	}
	if (!targets.length) {
		throw new Error("select at least one adapter/model");
	}
	const jobs = module.probes.flatMap((probe) =>
		(probe.execution.kind === "cli"
			? [{ adapter: cliAdapter, model: null }]
			: targets
		)
			.filter((target) => opts.include?.(probe, target) ?? true)
			.flatMap((target) =>
				Array.from({ length: opts.reps }, (_, repetition) => ({
					probe,
					target,
					repetition,
				})),
			),
	);
	const allowances = opts.budget ? admit(jobs, opts.budget) : undefined;
	await mkdir(opts.directory, { recursive: true });
	const results: StoredRun[] = [];
	let index = 0;
	const worker = async () => {
		for (;;) {
			const jobIndex = index++;
			const job = jobs[jobIndex];
			if (!job) {
				return;
			}
			const stored = await runOne(job.probe, {
				...opts,
				seed: module.seeds.find(
					(seed) =>
						seed.id === job.probe.seed.id &&
						seed.version === job.probe.seed.version,
				),
				target: job.target,
				repetition: job.repetition,
				allowance: allowances?.[jobIndex],
			});
			results.push(stored.value);
			opts.completed?.(stored.value, stored.path);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(opts.parallel, jobs.length) }, worker),
	);
	return results;
}

async function runOne(
	probe: Probe,
	opts: RunOptions & {
		seed?: Seed;
		target: Target;
		repetition: number;
		allowance?: Readonly<Allowance>;
	},
): Promise<{ value: StoredRun; path: string }> {
	const { seed, target, repetition } = opts;
	const start = performance.now();
	const dir = await mkdtemp(join(opts.directory, "run-"));
	const isolation: ProbeIsolation = {
		repository: join(dir, "repo"),
		arborHome: join(dir, "arbor-home"),
		logs: join(dir, "logs"),
		outputs: join(dir, "outputs"),
		ports: [],
	};
	await Promise.all(
		[
			isolation.repository,
			isolation.arborHome,
			isolation.logs,
			isolation.outputs,
			join(dir, "home"),
			join(dir, "tmp"),
		].map((path) => mkdir(path, { recursive: true })),
	);
	const evidence: Evidence = {
		events: [],
		state: {},
		complete: [],
		termination: "infrastructure-error",
	};
	const usage: ProbeRun["usage"] = {
		milliseconds: 0,
		turns: 0,
		tokens: probe.execution.kind === "cli" ? 0 : null,
		costUsd: probe.execution.kind === "cli" ? 0 : null,
	};
	const run: ProbeRun = {
		schema: 1,
		identity: {
			probe: probe.id,
			probeVersion: probe.version,
			fixtureHash: hash([probe.seed, seed?.fingerprint]),
			assertionHash: hash(probe.assertions),
			skillHash: opts.skillHash,
			cliHash: opts.cliHash,
			adapterVersion: `${target.adapter.id}@${target.adapter.version}`,
			model: probe.execution.kind === "cli" ? null : target.model,
			configHash: configurationHash(
				probe,
				target,
				opts.allowUnmetered ?? false,
			),
			repetition,
		},
		isolation,
		evidence,
		usage,
		reproduction: [
			...opts.reproduction,
			...(probe.execution.kind === "agent"
				? ["--target", `${target.adapter.id}:${target.model}`]
				: []),
			"--probe",
			probe.id,
			"--reps",
			"1",
		],
	};
	const runtime: Record<string, Json> = opts.allowance
		? { reserved: { ...opts.allowance }, aggregateBudget: { ...opts.budget } }
		: {};
	const adapterIdentity = {
		version: target.adapter.version,
		config: target.adapter.config,
		runtime,
	};
	const path = join(dir, "result.json");
	await saveResult(path, {
		schema: 1,
		probe,
		agent: target.adapter.id,
		run: {
			...run,
			evidence: {
				...evidence,
				detail: "Run incomplete or interrupted before persistence",
			},
		},
		result: assessRun(probe, evidence),
		overheadMs: 0,
		warnings: [],
		conditions: { allowUnmetered: opts.allowUnmetered ?? false },
		adapter: adapterIdentity,
	});

	const controller = new AbortController();
	const disposers: (() => void | Promise<void>)[] = [];
	let traceClosed = false;
	const warnings: string[] = [];
	let stopped = false;
	let prepared = false;
	let executing = false;
	let closed = false;
	let adapterMs = 0;
	let adapterStart: number | null = null;
	const stop = () => {
		stopped = true;
		controller.abort("stop");
	};
	const context: RunContext = {
		probe,
		isolation,
		evidence,
		usage,
		runtime,
		signal: controller.signal,
		env: {
			PATH: process.env.PATH ?? "",
			HOME: join(dir, "home"),
			TMPDIR: join(dir, "tmp"),
			ARBOR_HOME: isolation.arborHome,
			XDG_CONFIG_HOME: join(dir, "home", ".config"),
			XDG_CACHE_HOME: join(dir, "home", ".cache"),
		},
		emit(event) {
			if (closed || stopped) {
				return;
			}
			eventSchema.parse(event);
			if (evidence.events.some((each) => each.id === event.id)) {
				throw new Error(`duplicate event id: ${event.id}`);
			}
			evidence.events.push(event);
			if (
				executing &&
				probe.stop.kind === "event" &&
				matches(event, probe.stop.match)
			) {
				stop();
			}
		},
		reply(text) {
			if (closed || stopped || !executing) {
				return;
			}
			evidence.reply = text;
			evidence.complete.push("reply");
			if (probe.stop.kind === "reply") {
				stop();
			}
		},
		trace(value) {
			if (!traceClosed) {
				appendFileSync(
					join(isolation.logs, "trace.jsonl"),
					`${JSON.stringify(value)}\n`,
				);
			}
		},
		cleanup(dispose) {
			disposers.push(dispose);
		},
		listen(fetch) {
			controller.signal.throwIfAborted();
			const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
			const port = server.port;
			if (port === undefined) {
				throw new Error("no assigned port");
			}
			isolation.ports.push(port);
			disposers.push(() => server.stop(true));
			return port;
		},
	};
	const cancel = () => controller.abort("cancelled");
	opts.signal?.addEventListener("abort", cancel, { once: true });
	if (opts.signal?.aborted) {
		cancel();
	}
	const timer = setTimeout(
		() => controller.abort("time limit"),
		Math.max(1, probe.bounds.milliseconds - (performance.now() - start)),
	);
	const aborted = new Promise<void>((resolve) => {
		if (controller.signal.aborted) {
			resolve();
		} else {
			controller.signal.addEventListener("abort", () => resolve(), {
				once: true,
			});
		}
	});
	try {
		if (!seed) {
			evidence.termination = "unsupported";
			evidence.detail = `no seed handler ${probe.seed.id}@${probe.seed.version}`;
		} else if (
			probe.execution.kind === "agent" &&
			!target.adapter.tokenBound &&
			!opts.allowance &&
			!opts.allowUnmetered
		) {
			evidence.termination = "unsupported";
			evidence.detail =
				"adapter cannot enforce token bound; explicitly select --allow-unmetered to use time/turn bounds";
		} else if (!controller.signal.aborted) {
			if (
				probe.execution.kind === "agent" &&
				!target.adapter.tokenBound &&
				!opts.allowance
			) {
				warnings.push(
					"Token bound unavailable; token usage/cost may be unknown. Time and turn bounds remain active.",
				);
			}
			const work = (async () => {
				await seed.prepare(context, probe.seed.data);
				prepared = true;
				if (controller.signal.aborted) {
					return;
				}
				executing = true;
				adapterStart = performance.now();
				if (opts.allowance) {
					await target.adapter.metering?.run(
						context,
						target.model,
						opts.allowance,
					);
				} else {
					await target.adapter.run(context, target.model);
				}
			})();
			await Promise.race([work, aborted]);
			if (controller.signal.aborted) {
				evidence.termination = stopped ? "stop" : "bound";
				if (!stopped) {
					evidence.detail = String(controller.signal.reason);
				}
			} else if (
				evidence.termination !== "unsupported" &&
				evidence.termination !== "bound"
			) {
				evidence.termination = "bound";
				evidence.detail = "adapter ended before the declared stop boundary";
			}
		} else {
			evidence.termination = "bound";
			evidence.detail = "cancelled before start";
		}
	} catch (error) {
		evidence.termination = "infrastructure-error";
		evidence.detail = String(error);
	} finally {
		if (adapterStart !== null) {
			adapterMs = performance.now() - adapterStart;
		}
		clearTimeout(timer);
		opts.signal?.removeEventListener("abort", cancel);
		closed = true;
		controller.abort("cleanup");

		await disposeResources();
	}
	// A fresh, bounded observation scope may run read-only CLI commands after agent cleanup.
	if (seed && prepared) {
		const observation = new AbortController();
		const remaining = Math.max(
			1,
			probe.bounds.milliseconds - (performance.now() - start),
		);
		try {
			evidence.state = await bounded(
				seed.observe({
					...context,
					signal: observation.signal,
					emit() {},
					reply() {},
				}),
				remaining,
			);
			evidence.complete.push("state");
		} catch (error) {
			if (evidence.termination === "stop") {
				evidence.termination = "infrastructure-error";
			}
			evidence.detail = `${evidence.detail ?? ""} observe: ${error}`;
		} finally {
			observation.abort();
			await disposeResources();
		}
	}
	if (
		evidence.termination === "stop" &&
		(usage.turns > probe.bounds.turns ||
			(target.adapter.tokenBound &&
				usage.tokens !== null &&
				usage.tokens > probe.bounds.tokens))
	) {
		evidence.termination = "bound";
		evidence.detail = "observed turn/token bound exceeded";
	}
	if (
		opts.allowance &&
		((usage.tokens !== null &&
			(!Number.isSafeInteger(usage.tokens) ||
				usage.tokens < 0 ||
				usage.tokens > opts.allowance.tokens)) ||
			(usage.costUsd !== null &&
				(!Number.isFinite(usage.costUsd) ||
					usage.costUsd < 0 ||
					usage.costUsd * 1000000 > opts.allowance.microUsd)))
	) {
		evidence.termination = "infrastructure-error";
		evidence.detail =
			"Provider violated its reserved metering contract; cost guarantee cannot be claimed";
	}
	traceClosed = true;
	async function disposeResources() {
		for (let dispose = disposers.pop(); dispose; dispose = disposers.pop()) {
			try {
				await bounded(Promise.resolve().then(dispose), 1000);
			} catch (error) {
				evidence.termination = "infrastructure-error";
				evidence.detail = `cleanup: ${error}`;
			}
		}
	}

	usage.milliseconds = performance.now() - start;

	const value: StoredRun = {
		schema: 1,
		probe,
		agent: target.adapter.id,
		run,
		result: assessRun(probe, evidence),
		overheadMs: Math.max(0, usage.milliseconds - adapterMs),
		warnings,
		conditions: { allowUnmetered: opts.allowUnmetered ?? false },
		adapter: adapterIdentity,
	};
	await saveResult(path, value);
	return { value, path };
}

async function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("observation/cleanup time limit")),
					milliseconds,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
