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
import type { Allowance } from "./probe-affordability";
import { finishUsage, observeUsage } from "./probe-budget-accounting";
import { bounded } from "./probe-deadline";
import {
	assessRun,
	configurationHash,
	hash,
	type RunContext,
	type RunOptions,
	type Seed,
	type StoredRun,
	saveResult,
	type Target,
} from "./probe-record";
import { eventSchema } from "./probe-schema";

export async function runOne(
	probe: Probe,
	opts: RunOptions & {
		seed?: Seed;
		target: Target;
		repetition: number;
		allowance?: Readonly<Allowance>;
		reservationId?: string;
		onLimit: () => void;
	},
): Promise<{ value: StoredRun; path: string }> {
	const { seed, target, repetition } = opts;
	const start = performance.now();
	const dir = await mkdtemp(join(opts.directory, "run-"));
	const isolation: ProbeIsolation = {
		repository: join(dir, "repo"),
		splatesHome: join(dir, "splates-home"),
		logs: join(dir, "logs"),
		outputs: join(dir, "outputs"),
		ports: [],
	};
	await Promise.all(
		[
			isolation.repository,
			isolation.splatesHome,
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
			skillHash: target.snapshot?.hash ?? opts.skillHash,
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
		reproduction: opts.experiment
			? opts.reproduction
			: [
					...opts.reproduction,
					...(probe.execution.kind === "agent"
						? [
								"--target",
								`${target.selector ?? target.adapter.id}:${target.model}`,
							]
						: []),
					"--probe",
					probe.id,
					"--reps",
					"1",
				],
	};
	const runtime: Record<string, Json> = opts.allowance
		? {
				reserved: { ...opts.allowance },
				limitModes: target.adapter.metering?.limits ?? {
					tokens: "hard",
					costUsd: "hard",
				},
				aggregateBudget: { ...opts.budget },
				sharedReservation: opts.reservationId ?? null,
			}
		: {};
	if (target.snapshot) {
		runtime.snapshot = { ...target.snapshot };
		runtime.experiment = opts.directory;
	}
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
			SPLATES_HOME: isolation.splatesHome,
			XDG_CONFIG_HOME: join(dir, "home", ".config"),
			XDG_CACHE_HOME: join(dir, "home", ".cache"),
		},
		reportUsage(value) {
			if (traceClosed) {
				return;
			}
			if (observeUsage(usage, value, opts.allowance)) {
				runtime.failureCause =
					opts.allowance &&
					usage.tokens !== null &&
					usage.tokens >= opts.allowance.tokens
						? "tokens"
						: "usd";
				opts.onLimit();
				controller.abort(
					"native budget threshold reached (in-flight overshoot possible)",
				);
			}
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
					runtime.failureCause ??=
						controller.signal.reason === "time limit"
							? "timeout"
							: "cancellation";
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
			runtime.failureCause = "cancellation";
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

	finishUsage(
		context,
		opts.allowance,
		target.adapter.metering,
		warnings,
		target.adapter.tokenBound,
	);
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
