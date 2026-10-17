import type { Event, Json, Probe } from "./probe";
import type { Allowance, LimitMode } from "./probe-affordability";
import type { Adapter, RunContext } from "./probe-record";

/** A native runtime owns its agent loop. These are observations, not inferred tool executions. */
export type NativeUpdate =
	| {
			kind: "usage";
			tokens: number | null;
			costUsd: number | null;
			final?: boolean;
	  }
	| { kind: "event"; event: Event }
	| { kind: "reply"; text: string }
	| { kind: "trace"; value: Json };

export interface NativeRequest {
	context: RunContext;
	model: string | null;
	allowance: Readonly<Allowance>;
	skill: { source: string; mode: "discovery" | "explicit" };
	/** Native implementation must enforce these tools before prompting, or return unsupported. */
	tools: Probe["tools"];
}

export interface NativeSession {
	/** Includes initialization/model selection, then the single native probe input. */
	run(emit: (update: NativeUpdate) => void): Promise<void>;
	/** Idempotent cancellation; dispose must also stop and await all owned descendants. */
	cancel(): void | Promise<void>;
	dispose(): void | Promise<void>;
}

export interface NativeDriver {
	id: string;
	version: string;
	config: Json;
	limits: { tokens: LimitMode; costUsd: LimitMode };
	/** Reservation includes the native session, retries and native child activity. */
	quote(probe: Probe, model: string | null): Allowance | null;
	/** Return an inert session; start resources and billable work only when run is called. */
	create(request: NativeRequest): NativeSession;
}

/** Shared lifecycle only: no model requests, tools, authentication or replacement loop here. */
export function nativeAdapter(
	driver: NativeDriver,
	skill: NativeRequest["skill"],
): Adapter {
	return {
		id: driver.id,
		version: driver.version,
		config: { driver: driver.config, skill, limits: driver.limits },
		tokenBound: driver.limits.tokens === "hard",
		async run() {
			throw new Error("Native execution requires an admitted allowance");
		},
		metering: {
			limits: driver.limits,
			quote: (probe, model) => driver.quote(probe, model),
			async run(context, model, allowance) {
				context.signal.throwIfAborted();
				context.runtime.nativeUsageComplete = false;
				const session = driver.create({
					context,
					model,
					allowance,
					skill,
					tools: context.probe.tools,
				});
				let cancellation: Promise<void> | undefined;
				const cancel = () => {
					cancellation ??= Promise.resolve().then(() => session.cancel());
					// Cleanup awaits and reports rejection rather than leaving it unhandled.
					void cancellation.catch(() => {});
				};
				context.cleanup(async () => {
					context.signal.removeEventListener("abort", cancel);
					cancel();
					await Promise.all([cancellation, session.dispose()]);
				});
				context.signal.addEventListener("abort", cancel, { once: true });
				context.usage.turns = 1;
				await session.run((update) => {
					if (update.kind === "usage") {
						context.runtime.nativeUsageComplete = update.final === true;
						context.reportUsage?.({
							tokens: update.tokens,
							costUsd: update.costUsd,
						});
					} else if (!context.signal.aborted) {
						if (update.kind === "reply") {
							context.reply(update.text);
						}
						if (update.kind === "event") {
							context.emit(update.event);
						}
						if (update.kind === "trace") {
							context.trace(update.value);
						}
					}
				});
			},
		},
	};
}
