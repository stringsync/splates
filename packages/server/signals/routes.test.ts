import { describe, expect, it } from "bun:test";
import type { Conversation } from "../conversations";
import { MemoryStorage } from "../storage/testing";
import { SignalBook } from "./book";
import type { SignalFunctions } from "./call";
import { SignalRoutes } from "./routes";
import type { SignalRaise, SignalWait } from "./types";

describe("SignalRoutes", () => {
	const make = (signalFunctions: SignalFunctions = {}) => {
		const conversation = fake();
		const now = Date.parse("2026-11-18T12:00:00Z");
		const probed: string[] = [];
		const started: unknown[] = [];
		const retired: string[][] = [];
		const routes = new SignalRoutes({
			book: new SignalBook(
				new MemoryStorage().document("signals.json"),
				() => now,
			),
			all: async () => [conversation],
			find: async (id) => (id === "c1" ? conversation : null),
			rootOf: async (id) => (id === "c1" ? "/repo" : null),
			signalFunctions: async () => signalFunctions,
			retireFamilies: async (known) => {
				retired.push(Object.keys(known));
			},
			probes: {
				start: async (ask) => {
					started.push(ask);
					return ask as never;
				},
				subscribed: async (name) => {
					probed.push(`subscribed ${name}`);
				},
				unsubscribed: async (name) => {
					probed.push(`unsubscribed ${name}`);
				},
				stop: async (name) => {
					probed.push(`stop ${name}`);
				},
				pollNow: async (name) => {
					probed.push(`poll now ${name}`);
					return { name, state: "running" } as never;
				},
			},
			rootOfProject: async (slug) => (slug === "aws" ? "/aws-repo" : null),
			shell: async (script) =>
				script === "ok"
					? { exitCode: 0, stdout: "up\n", stderr: "" }
					: { exitCode: 3, stdout: "", stderr: "still building" },
			now: () => now,
		});
		return { conversation, routes, probed, started, retired };
	};

	it("polls a signal now when the person asks, answering with its probe", async () => {
		const { routes, probed } = make();
		const answer = await routes.pollNow(
			post("/api/signals/poll-now", { name: "aws.stack-ready" }),
		);
		expect(probed).toEqual(["poll now aws.stack-ready"]);
		expect(await answer.json()).toMatchObject({ name: "aws.stack-ready" });
	});

	it("delivers a slash-spelled announcement to waits on the dotted name", async () => {
		const { conversation, routes } = make();
		const sent = await routes.announce("mono/cred.saved/API_TOKEN", "creds", {
			name: "API_TOKEN",
		});
		expect(sent.name).toBe("mono.cred.saved.API_TOKEN");
		expect(conversation.raised).toEqual(["mono.cred.saved.API_TOKEN"]);
	});

	it("sets and clears optional expiration without raising the signal", async () => {
		const { routes } = make();
		await routes.raise(
			post("/api/signals/raise", { name: "mdom.released", by: "test" }),
		);
		const deadline = await (
			await routes.expiration(
				post("/api/signals/expiration", {
					name: "mdom.released",
					expires: "2h",
				}),
			)
		).json();
		expect(deadline.expiresAt).toBe("2026-11-18T14:00:00.000Z");
		const listed = await (await routes.list()).json();
		expect(
			listed.signals.find(
				(each: { name: string }) => each.name === "mdom.released",
			).expiresAt,
		).toBe(deadline.expiresAt);
		await routes.expiration(
			post("/api/signals/expiration", { name: "mdom.released", expires: null }),
		);
		const cleared = await (await routes.list()).json();
		expect(
			cleared.signals.find(
				(each: { name: string }) => each.name === "mdom.released",
			).expiresAt,
		).toBeUndefined();
		expect(
			cleared.signals.find(
				(each: { name: string }) => each.name === "mdom.released",
			).raises,
		).toHaveLength(1);
		expect(
			routes.expiration(
				post("/api/signals/expiration", {
					name: "mdom.released",
					expires: "0s",
				}),
			),
		).rejects.toThrow("expiration");
	});

	it("expires a one-off signal once it is fired, and --clear unmarks it", async () => {
		const { routes } = make();
		await routes.expiration(
			post("/api/signals/expiration", { name: "mdom.released", onFire: true }),
		);
		await routes.raise(
			post("/api/signals/raise", { name: "mdom.released", by: "test" }),
		);
		await new Promise((done) => setTimeout(done, 0));
		const listed = await (await routes.list()).json();
		const signal = listed.signals.find(
			(each: { name: string }) => each.name === "mdom.released",
		);
		expect(signal.expiresAt).toBe("2026-11-18T12:00:00.000Z");

		await routes.expiration(
			post("/api/signals/expiration", { name: "aws.up", onFire: true }),
		);
		await routes.expiration(
			post("/api/signals/expiration", { name: "aws.up", expires: null }),
		);
		await routes.raise(post("/api/signals/raise", { name: "aws.up", by: "t" }));
		await new Promise((done) => setTimeout(done, 0));
		const after = await (await routes.list()).json();
		expect(
			after.signals.find((each: { name: string }) => each.name === "aws.up")
				.expiresAt,
		).toBeUndefined();
	});

	it("delivers a raise to every conversation and says how many woke", async () => {
		const { conversation, routes } = make();
		const answer = await (
			await routes.raise(
				post("/api/signals/raise", {
					name: "mdom.released",
					by: "t",
					payload: { v: 1 },
				}),
			)
		).json();

		expect(answer.delivered).toBe(1);
		expect(conversation.raised).toEqual(["mdom.released"]);
	});

	it("takes a wait with its timeout, and reads a raise kept since", async () => {
		const { conversation, routes } = make();
		await routes.raise(
			post("/api/signals/raise", {
				name: "mdom.released",
				by: "t",
				payload: 1,
			}),
		);
		await routes.wait(
			post("/api/conversations/c1/signal-wait", {
				name: "mdom.released",
				description: "mdom on npm",
				timeout: "5h",
				since: "1h",
			}),
		);

		expect(conversation.asked[0]).toMatchObject({
			name: "mdom.released",
			timeoutMs: 5 * 3_600_000,
			already: { by: "t" },
		});
	});

	it("refuses a wait with no description or no timeout", async () => {
		const { routes } = make();
		const wait = (given: object) =>
			routes.wait(
				post("/api/conversations/c1/signal-wait", { name: "a/b", ...given }),
			);

		expect(wait({ timeout: "1h" })).rejects.toThrow("--description");
		expect(wait({ description: "x" })).rejects.toThrow("--timeout");
	});

	it("refuses a wait nothing can raise, saying how to declare it", async () => {
		const { routes } = make();
		const wait = routes.wait(
			post("/api/conversations/c1/signal-wait", {
				name: "aws.stack-ready",
				description: "stack up",
				timeout: "1h",
			}),
		);

		expect(wait).rejects.toThrow("signals");
	});

	it("names a signal by its canonical call, and takes a standard signal function", async () => {
		const { conversation, routes } = make();
		await routes.wait(
			post("/api/conversations/c1/signal-wait", {
				name: 'clock.in("2  Days")',
				description: "later",
				timeout: "1d",
			}),
		);

		expect(conversation.asked[0]).toMatchObject({
			name: `clock.in({ after: "172800s", tz: "${Intl.DateTimeFormat().resolvedOptions().timeZone}" })`,
		});
	});

	it("runs a signal's probe when a wait begins on it", async () => {
		const { routes, probed } = make({
			"aws.stack-ready": { description: "stack up" },
		});
		await routes.wait(
			post("/api/conversations/c1/signal-wait", {
				name: "aws.stack-ready",
				description: "stack up",
				timeout: "1h",
			}),
		);

		expect(probed).toEqual(["subscribed aws.stack-ready"]);
	});

	it("starts a probe in the main tree of the conversation's project", async () => {
		const { routes, started } = make();
		await routes.probe(
			post("/api/conversations/c1/signal-probe", {
				name: "aws.stack-ready",
				description: "stack up",
				script: "exit 0",
				every: "30s",
				timeout: "6h",
			}),
		);

		expect(started[0]).toEqual({
			name: "aws.stack-ready",
			description: "stack up",
			script: "exit 0",
			everyMs: 30_000,
			timeoutMs: 6 * 3_600_000,
			cwd: "/repo",
			conversation: "c1",
		});
	});

	it("starts a check from the page in its project's main tree, with no conversation", async () => {
		const { routes, started } = make();
		await routes.check(
			post("/api/signals/check", {
				name: "aws.stack-ready",
				description: "stack up",
				script: "ok",
				every: "5m",
				timeout: "6h",
			}),
		);

		expect(started).toEqual([
			{
				name: "aws.stack-ready",
				description: "stack up",
				script: "ok",
				everyMs: 300_000,
				timeoutMs: 21_600_000,
				cwd: "/aws-repo",
				conversation: "",
			},
		]);
	});

	it("refuses a check in a project it does not know", async () => {
		const { routes } = make();

		expect(
			routes.check(
				post("/api/signals/check", {
					name: "nope/x",
					description: "d",
					script: "ok",
					every: "5m",
					timeout: "1h",
				}),
			),
		).rejects.toThrow("no project 'nope'");
	});

	it("tests a check's command once, answering with its exit and output, raising nothing", async () => {
		const { routes, started, conversation } = make();
		const pass = await (
			await routes.testCheck(
				post("/api/signals/check-test", { name: "aws/x", script: "ok" }),
			)
		).json();
		const fail = await (
			await routes.testCheck(
				post("/api/signals/check-test", { name: "aws/x", script: "bad" }),
			)
		).json();

		expect([pass.exit, pass.output]).toEqual([0, "up"]);
		expect([fail.exit, fail.output]).toEqual([3, "still building"]);
		expect(started).toEqual([]);
		expect(conversation.raised).toEqual([]);
	});

	it("refuses a probe with no --every or --timeout", async () => {
		const { routes } = make();
		const probe = (given: object) =>
			routes.probe(
				post("/api/conversations/c1/signal-probe", {
					name: "a/b",
					script: "true",
					description: "x",
					...given,
				}),
			);

		expect(probe({ timeout: "1h" })).rejects.toThrow("--every");
		expect(probe({ every: "1m" })).rejects.toThrow("--timeout");
	});

	it("ends waits from undeclared signal functions after loading configuration", async () => {
		const signalFunctions: SignalFunctions = {
			"aws.ready": { description: "ready", args: {} },
		};
		const { routes, conversation, retired } = make(signalFunctions);
		const ended: string[] = [];
		conversation.state.signals = [
			{
				id: "w",
				name: "aws.ready",
				family: "aws.ready",
				state: "waiting",
			} as SignalWait,
		];
		conversation.removeSignal = (name, reason) => {
			ended.push(`${name}: ${reason}`);
			return 1;
		};
		await routes.wait(
			post("/api/conversations/c1/signal-wait", {
				name: "aws.ready",
				description: "ready",
				timeout: "1h",
			}),
		);
		await routes.reconcileSignalFunctions();
		expect(ended).toEqual([]);
		delete signalFunctions["aws.ready"];
		await routes.reconcileSignalFunctions();
		expect(ended).toEqual(["aws.ready: signal function aws.ready undeclared"]);
		expect(retired.at(-1)).not.toContain("aws.ready");
		expect(retired[0]).toContain("aws.ready");
	});

	it("checks the probe once a wait is stopped", async () => {
		const { routes, probed } = make();
		await routes.stop(post("/api/conversations/c1/signal-wait/w/stop", {}));

		expect(probed).toEqual(["unsubscribed a/b"]);
	});
});

/** A conversation that keeps what routes tell it of signals. */
function fake(): Conversation & { raised: string[]; asked: unknown[] } {
	const raised: string[] = [];
	const asked: unknown[] = [];
	return {
		raised,
		asked,
		waitOnSignal: (ask: unknown) => {
			asked.push(ask);
			return { id: "w", state: "waiting" } as SignalWait;
		},
		deliverSignal: (name: string, _raise: SignalRaise) => {
			raised.push(name);
			return 1;
		},
		stopSignal: (id: string) =>
			({ id, name: "a/b", state: "stopped" }) as SignalWait,
		state: { signals: [] },
	} as unknown as Conversation & { raised: string[]; asked: unknown[] };
}

function post(path: string, body: unknown): Request {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}
