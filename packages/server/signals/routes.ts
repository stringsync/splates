import type { Conversation } from "../conversations";
import { fail } from "../exit";
import { body } from "../server/shared";
import { checkName, projectOf, type SignalBook } from "./book";
import { type AutomationOn, overview } from "./overview";
import type { Probes } from "./probes";
import { durationMs, sinceOf } from "./time";
import { PROBE_RUN_MS } from "./types";

/** Where the signal routes find conversations, across every project the server holds. */
export interface SignalHome {
	book: SignalBook;
	/** Every conversation of every project and General, opening the unopened. */
	all(): Promise<Conversation[]>;
	/** The conversation `id`, or null for none. */
	find(id: string): Promise<Conversation | null>;
	/** The main tree of the project that holds conversation `id`, where its probes run; null for none. */
	rootOf(id: string): Promise<string | null>;
	probes: Pick<Probes, "start" | "subscribed" | "unsubscribed" | "stop">;
	now(): number;
	/** The main tree of the project whose slug is `slug`, where its checks run; null for none. */
	rootOfProject?(slug: string): Promise<string | null>;
	/** Runs `script` with `sh -c` in `cwd`, killed after `timeoutMs`. */
	shell?(
		script: string,
		cwd: string,
		timeoutMs: number,
	): Promise<{ exitCode: number; stdout: string; stderr: string }>;
	/** Every automation set on a signal, across every project. */
	automations?(): Promise<AutomationOn[]>;
	/** Fires every project's automations set on `name`, which runs apart from the raise. */
	fire?(name: string, by: string, payload: unknown): Promise<void>;
}

/** Raises `name` in every conversation `home` holds, firing the automations on it; how many waits it ended. */
export async function raiseIn(
	home: Pick<SignalHome, "book" | "all" | "fire">,
	name: string,
	by: string,
	payload: unknown,
): Promise<{ at: string; delivered: number }> {
	const raise = await home.book.raise(name, by, payload);
	let delivered = 0;
	for (const conversation of await home.all()) {
		delivered += conversation.deliverSignal(name, raise);
	}
	void home.fire?.(name, by, raise.payload);
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
		const name = checkName(String(given.name ?? ""));
		const by = String(given.by ?? "").trim() || "an agent";
		return Response.json(await this.announce(name, by, given.payload));
	};

	/** Raises `name` as the route does, for code in this server; how many waits it woke. */
	async announce(
		name: string,
		by: string,
		payload: unknown,
	): Promise<{ name: string; at: string; delivered: number }> {
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
		const name = checkName(String(given.name ?? ""));
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
		const wait = conversation.waitOnSignal({
			name,
			description,
			timeoutMs: durationMs(timeout),
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
			name: checkName(String(given.name ?? "")),
			description: String(given.description ?? ""),
			script: String(given.script ?? ""),
			everyMs: durationMs(every),
			timeoutMs: durationMs(timeout),
			cwd,
			conversation: id,
		});
		return Response.json(probe);
	};

	/**
	 * `GET /api/signals`: every signal with a raise, a probe or a subscriber,
	 * and how many are armed.
	 */
	readonly list = async (): Promise<Response> => {
		const conversations = await this.home.all();
		const signals = overview({
			raises: await this.home.book.raises(),
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
		return Response.json({
			signals,
			armed: signals.filter((each) => each.armed).length,
		});
	};

	/**
	 * `POST /api/signals/check`: `name`, `description`, `script`, `every` and
	 * `timeout`, as the Signals page's form sends them. Starts (or restarts)
	 * the signal's probe in the main tree of the project its name begins with.
	 */
	readonly check = async (request: Request): Promise<Response> => {
		const given = await body(request);
		const name = checkName(String(given.name ?? ""));
		const cwd = await this.#rootOf(name);
		const probe = await this.home.probes.start({
			name,
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
		const cwd = await this.#rootOf(checkName(String(given.name ?? "")));
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
		const name = checkName(String(given.name ?? ""));
		await this.home.probes.stop(name);
		return Response.json({ name });
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
