import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { FileLock } from "webappwiz/system";
import { z } from "zod";
import { type Allowance, validateAllowance } from "./probe-affordability";
import {
	type Declaration,
	declared,
	limits,
	saySpend,
	windowStart,
} from "./probe-budget-policy";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usage = z
	.object({
		tokens: integer.nullable(),
		costUsd: z.number().finite().nonnegative().nullable(),
	})
	.strict();
const entry = z
	.object({
		id: z.string().min(1),
		at: integer,
		finished: integer.nullable(),
		jobs: integer.positive(),
		tokens: integer.positive(),
		microUsd: integer.positive(),
		observed: z.array(usage).nullable(),
	})
	.strict();
const state = z
	.object({
		schema: z.literal(1),
		set: z.unknown().optional(),
		entries: z.array(entry),
	})
	.strict();
type State = z.infer<typeof state>;
type Usage = z.infer<typeof usage>;

/** Persist shared eval allowances and usage; reserve a batch before starting it. */
export class EvalBudgets {
	constructor(
		readonly path: string,
		private readonly config?: Declaration,
		private readonly now: () => number = Date.now,
	) {}

	async report() {
		return this.describe(await this.read());
	}
	async set(value: Declaration["spend"] | undefined): Promise<void> {
		if (value !== undefined) {
			declared(value, this.path);
		}
		await this.change((kept) => {
			kept.set = value;
		});
	}
	/** Charge the entire invocation under one process-shared lock before any seed or request. */
	async reserve(allowances: readonly Readonly<Allowance>[]): Promise<string> {
		const total = { tokens: 0, microUsd: 0 };
		for (const allowance of allowances) {
			validateAllowance(allowance);
			total.tokens += allowance.tokens;
			total.microUsd += allowance.microUsd;
		}
		validateAllowance(total);
		const id = randomUUID();
		await this.change((kept) => {
			const report = this.describe(kept);
			if (!report.declared) {
				throw new Error(
					"No eval token budget declared; configure eval.config.ts or eval budgets set <tokens/window>. No agents launched.",
				);
			}
			for (const window of report.windows) {
				if (total.tokens > window.remaining) {
					throw new Error(
						`Eval token budget exhausted for ${window.window}: ${total.tokens} requested, ${window.remaining} remaining; no agents launched`,
					);
				}
			}
			kept.entries.push({
				id,
				at: this.now(),
				finished: null,
				jobs: allowances.length,
				...total,
				observed: null,
			});
		});
		return id;
	}
	/** Usage is informational; never refund a reservation, even on successful completion. */
	async finish(
		id: string,
		observations: Usage[],
		complete: boolean,
	): Promise<void> {
		await this.change((kept) => {
			const reservation = kept.entries.find((item) => item.id === id);
			if (!reservation || reservation.observed !== null) {
				throw new Error("Unknown or already recorded eval reservation");
			}
			if (observations.length !== reservation.jobs) {
				throw new Error("Incomplete eval usage observations");
			}
			reservation.observed = observations.map((item) => usage.parse(item));
			// Unknown or potentially still-running work remains charged across ALL window resets.
			if (
				complete &&
				observations.length === reservation.jobs &&
				observations.every(
					(item) => item.tokens !== null && item.costUsd !== null,
				)
			) {
				reservation.finished = Math.max(reservation.at, this.now());
			}
		});
	}
	private describe(kept: State) {
		const declaration =
			kept.set === undefined ? this.config : declared(kept.set, this.path);
		const now = this.now();
		const observations = kept.entries.flatMap((item) => item.observed ?? []);
		return {
			observedTokens: observations.reduce(
				(sum, item) => sum + (item.tokens ?? 0),
				0,
			),
			observedUsd: observations.reduce(
				(sum, item) => sum + (item.costUsd ?? 0),
				0,
			),
			unknownTokenJobs: kept.entries.reduce(
				(sum, item) =>
					sum +
					item.jobs -
					(item.observed?.filter((value) => value.tokens !== null).length ?? 0),
				0,
			),
			unknownCostJobs: kept.entries.reduce(
				(sum, item) =>
					sum +
					item.jobs -
					(item.observed?.filter((value) => value.costUsd !== null).length ??
						0),
				0,
			),
			declared: declaration !== undefined,
			spend: declaration ? saySpend(declaration.spend) : null,
			from: declaration?.from ?? null,
			set: kept.set !== undefined,
			unit: "total tokens: input (including cached), output (including reasoning), counted once",
			windows: declaration
				? limits(declaration.spend).map((limit) => {
						const relevant =
							limit.per === "check"
								? []
								: kept.entries.filter(
										(item) =>
											item.finished === null ||
											item.finished >= windowStart(limit, now),
									);
						const reserved = relevant
							.filter((item) => item.finished === null)
							.reduce(
								(sum, item) =>
									sum +
									Math.max(
										item.tokens,
										(item.observed ?? []).reduce(
											(total, value) => total + (value.tokens ?? 0),
											0,
										),
									),
								0,
							);
						const consumed = relevant
							.filter((item) => item.finished !== null)
							.reduce(
								(sum, item) =>
									sum +
									Math.max(
										item.tokens,
										(item.observed ?? []).reduce(
											(total, value) => total + (value.tokens ?? 0),
											0,
										),
									),
								0,
							);
						return {
							window: limit.per ?? limit.within,
							limit: limit.tokens,
							consumed,
							reserved,
							remaining: Math.max(0, limit.tokens - consumed - reserved),
						};
					})
				: [],
			reservations: kept.entries,
			costNote:
				"Reservations are admission allowances, not provider billing ceilings, observed USD is reported usage. Token prices vary by model and token category; unknown is not zero. Invocation defaults 4000 tokens/USD 0.10; hard maxima 10000/USD 0.25 remain mandatory.",
		};
	}
	private async read(): Promise<State> {
		let raw: string;
		try {
			raw = await readFile(this.path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return { schema: 1, entries: [] };
			}
			throw error;
		}
		const kept = state.parse(JSON.parse(raw));
		if (kept.set !== undefined) {
			declared(kept.set, this.path);
		}
		if (
			new Set(kept.entries.map((item) => item.id)).size !== kept.entries.length
		) {
			throw new Error("Duplicate eval reservations");
		}
		for (const item of kept.entries) {
			if (
				item.finished !== null &&
				(item.finished < item.at ||
					item.observed?.length !== item.jobs ||
					item.observed.some(
						(value) => value.tokens === null || value.costUsd === null,
					))
			) {
				throw new Error("Invalid completed eval reservation");
			}
		}
		return kept;
	}
	private async change(edit: (kept: State) => void): Promise<void> {
		await mkdir(dirname(this.path), { recursive: true });
		const lock = new FileLock(`${this.path}.lock`);
		await lock.acquire();
		try {
			const kept = await this.read();
			edit(kept);
			const temporary = `${this.path}.${randomUUID()}.tmp`;
			await writeFile(temporary, `${JSON.stringify(kept, null, 2)}\n`, {
				mode: 0o600,
			});
			await rename(temporary, this.path);
		} finally {
			await lock.release();
		}
	}
}
