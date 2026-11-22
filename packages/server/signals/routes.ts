import type { Conversation } from "../conversations";
import { fail } from "../exit";
import { body } from "../server/shared";
import { dotted, projectOf, type SignalBook } from "./book";
import {
	callOf,
	type SignalFunctions,
	STANDARD_SIGNAL_FUNCTIONS,
} from "./call";
import { clockDuration } from "./clock-schedule";
import type { Clocks } from "./clocks";
import { type AutomationOn, overview } from "./overview";
import { isOn, type Probes } from "./probes";
import { durationMs, expirationOf, sinceOf } from "./time";
import { LONGEST_WAIT_MS, PROBE_RUN_MS } from "./types";

/** Where the signal routes find conversations, across every project the server holds. */
export interface SignalHome {
	book: SignalBook;
	clocks?: Pick<Clocks, "start">;
	/** Every conversation of every project and General, opening the unopened. */
	all(): Promise<Conversation[]>;
	/** The conversation `id`, or null for none. */
	find(id: string): Promise<Conversation | null>;
	/** The main tree of the project that holds conversation `id`, where its probes run; null for none. */
	rootOf(id: string): Promise<string | null>;
	probes: Pick<
		Probes,
		"start" | "subscribed" | "unsubscribed" | "stop" | "pollNow"
	>;
	now(): number;
	/** Rearms automatic signal removal after a deadline changes. */
	setExpiration?(name: string, at: string | null): Promise<void>;
	/** The main tree of the project whose slug is `slug`, where its checks run; null for none. */
	rootOfProject?(slug: string): Promise<string | null>;
	/** Runs `script` with `sh -c` in `cwd`, killed after `timeoutMs`. */
	shell?(
		script: string,
		cwd: string,
		timeoutMs: number,
	): Promise<{ exitCode: number; stdout: string; stderr: string }>;
	/** The signal functions every project declares in `splates.config.ts`, by name. */
	signalFunctions?(): Promise<SignalFunctions>;
	/** Every automation set on a signal, across every project. */
	automations?(): Promise<AutomationOn[]>;
	/** Fires every project's automations set on `name`, which runs apart from the raise. */
	fire?(name: string, by: string, payload: unknown): Promise<void>;
	/** Pauses every project's automations on a signal function not in `known`. */
	retireFamilies?(known: SignalFunctions): Promise<void>;
}

/** Raises `name` in every conversation `home` holds, firing the automations on it; how many waits it ended. */
export async function raiseIn(
	home: Pick<SignalHome, "book" | "all" | "fire"> &
		Partial<Pick<SignalHome, "now" | "setExpiration">>,
	name: string,
	by: string,
	payload: unknown,
): Promise<{ at: string; delivered: number }> {
	const raise = await home.book.raise(name, by, payload);
	let delivered = 0;
	for (const conversation of await home.all()) {
		delivered += conversation.deliverSignal(name, raise);
	}
	const fired = Promise.resolve(home.fire?.(name, by, raise.payload));
	if ((await home.book.once()).includes(name)) {
		// A one-off signal goes once its automations have run.
		void fired
			.catch(() => {})
			.then(() => {
				const at = new Date((home.now ?? Date.now)()).toISOString();
				return home.setExpiration !== undefined
					? home.setExpiration(name, at)
					: home.book.expireAt(name, at);
			});
	}
	return { at: raise.at, delivered };
}

/** How many waits across `home`'s conversations subscribe to `name`. */
export async function subscriptionsIn(
	home: Pick<SignalHome, "all">,
	name: string,
): Promise<number> {
	let count = 0;
	for (const conversation of await home.all()) {
		count += conversation.signalSubscriptions(name);
	}
	return count;
}

/**
 * Raises, waits on and probes signals for `splates signal` and the signal
 * cards, and stops a wait or a probe when the person asks.
 */
export class SignalRoutes {
	constructor(private readonly home: SignalHome) {}

	/**
	 * `POST /api/signals/raise`: `name`, `by` and any `payload`. Every wait on
	 * the name now is ended and its agent woken; the answer says how many.
	 */
	readonly raise = async (request: Request): Promise<Response> => {
		const given = await body(request);
		const name = await this.#call(String(given.name ?? ""));
		const by = String(given.by ?? "").trim() || "an agent";
		return Response.json(await this.announce(name, by, given.payload));
	};

	/** Raises `name` as the route does, for code in this server; how many waits it woke. */
	async announce(
		given: string,
		by: string,
		payload: unknown,
	): Promise<{ name: string; at: string; delivered: number }> {
		// Waits keep the dotted name, so a slash-spelled one (mono/cred.saved/X) must match it.
		const name = dotted(given);
		const { at, delivered } = await raiseIn(this.home, name, by, payload);
		return { name, at, delivered };
	}

	/**
	 * `POST /api/conversations/:id/signal-wait`: `name`, `description`,
	 * `timeout` and any `since`. Answers the wait, which may already have
	 * ended, when a raise since then was kept.
	 */
	readonly wait = async (request: Request): Promise<Response> => {
		const id = new URL(request.url).pathname.split("/")[3] ?? "";
		const conversation = await this.home.find(id);
		if (conversation === null) {
			fail("not_found", `no conversation '${id}'`, { conversation: id });
		}
		const given = await body(request);
		const name = await this.#call(String(given.name ?? ""));
		const description = String(given.description ?? "").trim();
		if (description === "") {
			fail(
				"usage",
				"say what the wait is for with --description, in a short line",
				{},
			);
		}
		const timeout = String(given.timeout ?? "").trim();
		if (timeout === "") {
			fail("usage", "give --timeout, as 30m, 2h or 1d", {});
		}
		const since =
			given.since === undefined || given.since === ""
				? null
				: sinceOf(String(given.since), this.home.now());
		const already =
			since === null ? null : await this.home.book.after(name, since);
		await this.#requireSource(name, since !== null);
		await this.#startDeclared(name, id);
		const fn = callOf(name, await this.#signalFunctions()).fn;
		if (fn in (await this.#signalFunctions())) {
			await this.home.book.watchSignalFunction(fn);
		}
		const clock = name.startsWith("clock.")
			? await this.home.clocks?.start(name)
			: undefined;
		const wait = conversation.waitOnSignal({
			clock,
			...(fn in (await this.#signalFunctions()) ? { family: fn } : {}),
			name,
			description,
			timeoutMs: name.startsWith("clock.")
				? clockDuration(timeout)
				: durationMs(timeout),
			since,
			already,
		});
		if (wait.state !== "waiting") {
			return Response.json(wait);
		}
		// A probe on the signal runs now: a pass ends this wait at once.
		await this.home.probes.subscribed(name);
		return Response.json(
			conversation.state.signals.find((each) => each.id === wait.id) ?? wait,
		);
	};

	/**
	 * `POST /api/conversations/:id/signal-probe`: `name`, `description`,
	 * `script`, `every` and `timeout`. Starts the signal's probe, replacing
	 * any on it, to run in the main tree of the conversation's project.
	 */
	readonly probe = async (request: Request): Promise<Response> => {
		const id = new URL(request.url).pathname.split("/")[3] ?? "";
		const cwd = await this.home.rootOf(id);
		if (cwd === null) {
			fail("not_found", `no conversation '${id}' in a project`, {
				conversation: id,
			});
		}
		const given = await body(request);
		const every = String(given.every ?? "").trim();
		const timeout = String(given.timeout ?? "").trim();
		if (every === "") {
			fail("usage", "give --every, as 30s, 5m or 1h", {});
		}
		if (timeout === "") {
			fail("usage", "give --timeout, as 30m, 6h or 1d", {});
		}
		const probe = await this.home.probes.start({
			name: await this.#call(String(given.name ?? "")),
			description: String(given.description ?? ""),
			script: String(given.script ?? ""),
			args: await this.#argsOf(String(given.name ?? "")),
			everyMs: durationMs(every),
			timeoutMs: durationMs(timeout),
			cwd,
			conversation: id,
		});
		return Response.json(probe);
	};

	/** Sets an optional deadline independently of raising the signal. Null clears it. */
	readonly expiration = async (request: Request): Promise<Response> => {
		const given = await body(request);
		const name = await this.#call(String(given.name ?? ""));
		if (given.onFire === true) {
			await this.home.book.expireOnFire(name, true);
			return Response.json({ name, onFire: true });
		}
		if (given.expires !== null && typeof given.expires !== "string") {
			fail("usage", "give expires as a duration, date, or null", {});
		}
		if (given.expires === null) {
			await this.home.book.expireOnFire(name, false);
		}
		const expiresAt =
			given.expires === null
				? null
				: expirationOf(String(given.expires), this.home.now());
		if (this.home.setExpiration !== undefined) {
			await this.home.setExpiration(name, expiresAt);
		} else {
			await this.home.book.expireAt(name, expiresAt);
		}
		return Response.json({ name, expiresAt });
	};

	/**
	 * `GET /api/signals`: every signal with a raise, a probe or a subscriber,
	 * and how many live subscribers they have.
	 */
	readonly list = async (): Promise<Response> => {
		const conversations = await this.home.all();
		const deadlines = await this.home.book.expirations();
		const raises = await this.home.book.raises();
		for (const name of Object.keys(deadlines)) {
			raises[name] ??= [];
		}
		const signals = overview({
			raises,
			probes: await this.home.book.probes(),
			waits: conversations.map((each) => ({
				conversation: each.id,
				title: each.state.name ?? each.state.title,
				archived: each.state.archived,
				task: each.state.task,
				waits: each.state.signals,
			})),
			automations: (await this.home.automations?.()) ?? [],
			now: this.home.now(),
		});
		const clocks = await this.home.book.clocks();
		for (const signal of signals) {
			const clock = clocks.find((each) => each.name === signal.name);
			if (clock) {
				signal.clock = clock;
			}
		}
		const removed = new Set(await this.home.book.removed());
		for (const signal of signals) {
			const at = deadlines[signal.name];
			if (at !== undefined) {
				signal.expiresAt = at;
			}
		}
		const visible = signals.filter((each) => !removed.has(each.name));
		return Response.json({
			signals: visible,
			subscribers: visible.reduce(
				(sum, each) => sum + each.subscribers.filter((one) => one.live).length,
				0,
			),
		});
	};

	/**
	 * `POST /api/signals/check`: `name`, `description`, `script`, `every` and
	 * `timeout`, as the Signals page's form sends them. Starts (or restarts)
	 * the signal's probe in the main tree of the project its name begins with.
	 */
	readonly check = async (request: Request): Promise<Response> => {
		const given = await body(request);
		const name = await this.#call(String(given.name ?? ""));
		const cwd = await this.#rootOf(name);
		const probe = await this.home.probes.start({
			name,
			args: await this.#argsOf(name),
			description: String(given.description ?? ""),
			script: String(given.script ?? ""),
			everyMs: durationMs(timeIn(given.every, "how often it runs, as 5m")),
			timeoutMs: durationMs(timeIn(given.timeout, "when it gives up, as 6h")),
			cwd,
			conversation: "",
		});
		return Response.json(probe);
	};

	/**
	 * `POST /api/signals/check-test`: `name` and `script`. Runs the script
	 * once where the check would and answers with its exit code and last
	 * lines. Nothing is raised and no probe starts.
	 */
	readonly testCheck = async (request: Request): Promise<Response> => {
		const given = await body(request);
		const script = String(given.script ?? "");
		if (script.trim() === "") {
			fail("usage", "give the command to test", {});
		}
		const cwd = await this.#rootOf(await this.#call(String(given.name ?? "")));
		const started = this.home.now();
		let exit: number;
		let output: string;
		const shell = this.home.shell;
		if (shell === undefined) {
			fail("usage", "this server cannot run a check", {});
		}
		try {
			const run = await shell(script, cwd, PROBE_RUN_MS);
			exit = run.exitCode;
			output = lastLines(run.stdout, run.stderr);
		} catch (error) {
			exit = 1;
			output = String(error);
		}
		return Response.json({ exit, output, ms: this.home.now() - started });
	};

	/** Reconciles persisted declared-signal function waits after loading configuration. */
	async reconcileSignalFunctions(): Promise<void> {
		const signalFunctions = await this.#signalFunctions();
		await this.home.retireFamilies?.(signalFunctions);
		if (!(await this.home.book.hasSignalFunctionWaits())) {
			return;
		}
		const conversations = await this.home.all();
		for (const conversation of conversations) {
			for (const wait of conversation.state.signals) {
				if (
					wait.state === "waiting" &&
					wait.family !== undefined &&
					!(wait.family in signalFunctions)
				) {
					conversation.removeSignal(
						wait.name,
						`signal function ${wait.family} undeclared`,
					);
				}
			}
		}
	}

	/** The signal functions known here: the standard ones and every project's declared. */
	async #signalFunctions(): Promise<SignalFunctions> {
		return {
			...(await this.home.signalFunctions?.()),
			...STANDARD_SIGNAL_FUNCTIONS,
		};
	}

	/** The canonical call for `text`, which names the signal. */
	async #call(text: string): Promise<string> {
		return callOf(text, await this.#signalFunctions()).canonical;
	}

	/** The arguments of `text` as JSON, or undefined for none. */
	async #argsOf(text: string): Promise<string | undefined> {
		const { args } = callOf(text, await this.#signalFunctions());
		return Object.keys(args).length === 0 ? undefined : JSON.stringify(args);
	}

	/**
	 * Refuses a wait on a signal nothing can raise: not a standard or declared
	 * signal function, with no probe on it and no raise in the last 7 days. A wait that
	 * reaches back with `--since` is not refused, for it may rest on a raise.
	 */
	async #requireSource(name: string, since: boolean): Promise<void> {
		const fn = callOf(name, await this.#signalFunctions()).fn;
		const signalFunctions = await this.#signalFunctions();
		if (since || fn in signalFunctions) {
			return;
		}
		const probe = await this.home.book.probe(name);
		if (probe !== null && isOn(probe)) {
			return;
		}
		if (((await this.home.book.raises())[name] ?? []).length > 0) {
			return;
		}
		fail(
			"usage",
			`nothing can raise ${name}: it is no standard signal function, none is declared for ${fn}, no poll script runs on it and nothing raised it in 7 days. Declare it under \`signals\` in splates.config.ts (a task changes it), start \`splates signal poll ${name} ...\`, or have the task that makes it true run \`splates signal raise ${name}\` first`,
			{ name, fn },
		);
	}

	/** A declared signal function's own probe starts when its first wait does, in its project's main tree. */
	async #startDeclared(name: string, conversation: string): Promise<void> {
		const { fn, args } = callOf(name, await this.#signalFunctions());
		const probe = (await this.#signalFunctions())[fn]?.poll;
		if (probe === undefined || STANDARD_SIGNAL_FUNCTIONS[fn] !== undefined) {
			return;
		}
		const existing = await this.home.book.probe(name);
		if (existing !== null && isOn(existing)) {
			return;
		}
		const cwd = await this.home.rootOf(conversation);
		if (cwd === null) {
			return;
		}
		await this.home.probes.start({
			name,
			description: `${fn}: declared poll script`,
			script: probe.script,
			args: Object.keys(args).length === 0 ? undefined : JSON.stringify(args),
			everyMs: durationMs(probe.interval),
			timeoutMs: LONGEST_WAIT_MS,
			cwd,
			conversation,
		});
	}

	async #rootOf(name: string): Promise<string> {
		const slug = projectOf(name);
		const root = (await this.home.rootOfProject?.(slug)) ?? null;
		if (root === null) {
			fail("not_found", `no project '${slug}' to run the check in`, { slug });
		}
		return root;
	}

	/** `POST /api/signals/probe-stop`: `name`. The person stops its probe. */
	readonly stopProbe = async (request: Request): Promise<Response> => {
		const given = await body(request);
		const name = await this.#call(String(given.name ?? ""));
		await this.home.probes.stop(name);
		return Response.json({ name });
	};

	/**
	 * `POST /api/signals/poll-now`: `name`. Runs its poll script at once and
	 * answers with the probe once the run is done; a pass fires the signal.
	 */
	readonly pollNow = async (request: Request): Promise<Response> => {
		const given = await body(request);
		const name = await this.#call(String(given.name ?? ""));
		return Response.json(await this.home.probes.pollNow(name));
	};

	/** `POST /api/conversations/:id/signal-wait/:wait/stop`: the person stops waiting. */
	readonly stop = async (request: Request): Promise<Response> => {
		const parts = new URL(request.url).pathname.split("/");
		const conversation = await this.home.find(parts[3] ?? "");
		if (conversation === null) {
			fail("not_found", "no such conversation", {});
		}
		const wait = conversation.stopSignal(decodeURIComponent(parts[5] ?? ""));
		await this.home.probes.unsubscribed(wait.name);
		return Response.json(wait);
	};
}

/** The last lines a test run printed. */
function lastLines(stdout: string, stderr: string): string {
	const lines = [stdout.trim(), stderr.trim()]
		.filter((each) => each !== "")
		.join("\n")
		.split("\n");
	return lines.slice(-20).join("\n").slice(-4000);
}

/** A duration a form sent, refusing a blank one. */
function timeIn(value: unknown, what: string): string {
	const text = String(value ?? "").trim();
	if (text === "") {
		fail("usage", `say ${what}`, {});
	}
	return text;
}
