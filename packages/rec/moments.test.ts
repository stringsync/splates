import { describe, expect, test } from "bun:test";
import { type Answer, Jev, type Question } from "./jev";
import { buildMoments, codeScore, rankAbout, speechScore } from "./moments";
import { renderMoments } from "./moments-files";
import type { Signal } from "./signals";
import type { Transcript } from "./timeline";

describe("moments", () => {
	test("the strongest signal leads and the rest add a little", () => {
		expect(codeScore([])).toBe(0);
		expect(codeScore([signal(0, "mark", "events")])).toBe(1);
		const two = codeScore([
			signal(0, "request-failed", "logs/network.log"),
			signal(1, "console-error", "logs/console.log"),
		]);
		expect(two).toBeGreaterThan(0.6);
		expect(two).toBeLessThan(1);
	});

	test("a reported bug said with weight outscores narration", () => {
		const bug = speechScore({
			problem: 0.95,
			remark: { choice: "bug", probabilities: { bug: 1 } },
			importance: 0.9,
		});
		const narration = speechScore({
			problem: 0.02,
			remark: {
				choice: "narration only",
				probabilities: { "narration only": 1 },
			},
			importance: 0,
		});
		expect(bug).toBeGreaterThan(0.8);
		expect(narration).toBeLessThan(0.05);
	});

	const answers = (state: State, questions: Record<string, Question>) => {
		const said: string = state.utterance;
		const bug = said.includes("broken");
		const out: Record<string, Answer> = {
			problem: noul(bug ? 0.95 : 0.02),
			screen: noul(0.9),
			remark: {
				type: "choice",
				choice: bug ? "bug" : "narration only",
				confidence: 0.9,
				probabilities: bug ? { bug: 1 } : { "narration only": 1 },
			},
			importance: {
				type: "score",
				score: bug ? 3 : 0,
				confidence: 0.9,
				probabilities: {},
			},
		};
		for (const id of Object.keys(questions)) {
			if (id.startsWith("related_")) {
				const text = state.events[Number(id.slice(8))] as string;
				out[id] = noul(text.includes("unrelated") ? 0.05 : 0.9);
			}
		}
		return out;
	};

	test("ranks the bug above narration and lists only related log lines", async () => {
		const { jev, calls } = fakeJev(answers);
		const result = await buildMoments({
			transcript: transcript([
				[1, 3, "I am just opening the page"],
				[20, 24, "this is broken, saving does nothing"],
			]),
			signals: [
				signal(22, "request-failed", "logs/network.log", {
					request: "POST /save",
					status: "500",
					ms: 40,
				}),
				signal(23, "log-error", "logs/docker-db.log", {
					text: "unrelated cron failed",
				}),
			],
			events: [
				{
					at: T0 + 21_000,
					type: "paused",
					component: "SaveButton",
					text: "Save",
				},
			],
			jev,
		});
		expect(calls.sort()).toEqual([4, 6]);
		expect(result.notes).toEqual([]);
		const [first] = result.moments;
		expect(first?.rank).toBe(1);
		expect(first?.said).toContain("broken");
		expect(first?.pointed).toBe('<SaveButton> "Save"');
		expect(first?.signals.map((item) => item.signal)).toEqual([
			"request-failed",
		]);
		expect(first?.judgment?.remark?.choice).toBe("bug");
		// Narration with nothing beside it is not a moment.
		expect(result.moments).toHaveLength(1);
		const md = renderMoments(result, T0);
		expect(md).toContain("## 1. 00:20.0-00:24.0");
		expect(md).toContain('said: "this is broken');
		expect(md).toContain("logs/network.log: request-failed POST /save");
		expect(md).not.toContain("unrelated cron");
	});

	test("signals with no speech near them are silent moments", async () => {
		const result = await buildMoments({
			transcript: transcript([]),
			signals: [
				signal(10, "exception", "logs/console.log", { text: "x" }),
				signal(12, "dead-click", "events", { element: "Buy" }),
				signal(60, "mark", "events", { label: "here" }),
			],
			events: [],
		});
		expect(result.moments.map((moment) => moment.signals.length)).toEqual([
			1, 2,
		]);
		expect(result.moments[0]?.signals[0]?.signal).toBe("mark");
	});

	test("an agent's remark is sent to Jev like a spoken line and ranks as a mark", async () => {
		const { jev, calls } = fakeJev(answers);
		const result = await buildMoments({
			transcript: transcript([]),
			signals: [signal(30, "mark", "events", { label: "step 2 is broken" })],
			events: [{ at: T0 + 30_000, type: "mark", label: "step 2 is broken" }],
			jev,
		});
		expect(calls).toHaveLength(1);
		expect(result.moments).toHaveLength(1);
		expect(result.moments[0]?.said).toBe("step 2 is broken");
		expect(result.moments[0]?.signals[0]?.signal).toBe("mark");
		expect(result.moments[0]?.parts.speech).toBeGreaterThan(0.5);
	});

	test("without Jev, it says so and ranks by signals alone", async () => {
		const result = await buildMoments({
			transcript: transcript([
				[1, 3, "this is broken"],
				[30, 32, "now I click"],
			]),
			signals: [
				signal(2, "console-error", "logs/console.log", { text: "boom" }),
			],
			events: [],
		});
		expect(result.notes[0]).toContain("TYPESAFE_API_KEY");
		expect(result.moments).toHaveLength(1);
		expect(result.moments[0]?.parts.speech).toBeUndefined();
		expect(renderMoments(result, T0)).toContain("Jev was not used");
	});

	test("a Jev failure falls back to code signals and says so", async () => {
		const jev = new Jev("key", {
			fetch: async () => new Response("no", { status: 500 }),
		});
		const result = await buildMoments({
			transcript: transcript([[1, 3, "this is broken"]]),
			signals: [
				signal(2, "console-error", "logs/console.log", { text: "boom" }),
			],
			events: [],
			jev,
		});
		expect(result.moments).toHaveLength(1);
		expect(result.notes[0]).toContain("Jev failed");
	});

	test("moves the moment about the prompt to the top", async () => {
		const { jev } = fakeJev((state) => ({
			about: noul(state.moment.said?.includes("checkout") ? 0.95 : 0.05),
		}));
		const base = await buildMoments({
			transcript: transcript([[1, 3, "the checkout form is odd"]]),
			signals: [
				signal(2, "console-error", "logs/console.log", { text: "a" }),
				signal(40, "mark", "events", { label: "m" }),
			],
			events: [],
		});
		expect(base.moments[0]?.signals[0]?.signal).toBe("mark");
		const ranked = await rankAbout(base.moments, "the checkout form", jev);
		expect(ranked[0]?.said).toContain("checkout");
		expect(ranked[0]?.parts.about).toBeGreaterThan(0.9);
	});

	test("retries when overloaded, then answers", async () => {
		let tries = 0;
		const jev = new Jev("key", {
			fetch: async () => {
				tries++;
				return tries < 2
					? new Response("slow down", { status: 429 })
					: Response.json({ answers: { a: { type: "noul", noul: 0.5 } } });
			},
		});
		expect(
			(await jev.ask("x", { a: { type: "noul", instructions: "q" } })).a,
		).toEqual(noul(0.5));
		expect(tries).toBe(2);
	});
});

const T0 = Date.parse("2026-11-03T12:00:00.000Z");
const signal = (
	seconds: number,
	kind: Signal["signal"],
	source: string,
	detail: Record<string, unknown> = {},
): Signal => ({ at: T0 + seconds * 1000, signal: kind, source, detail });

const transcript = (lines: [number, number, string][]): Transcript => ({
	version: 1,
	model: "whisper-1",
	prompt: "",
	startedAt: T0,
	text: "",
	words: [],
	utterances: lines.map(([start, end, text]) => ({
		start,
		end,
		text,
		words: [],
	})),
});

interface State {
	utterance: string;
	events: string[];
	moment: { said?: string };
}

/** A Jev that answers from a function of the state and questions. */
function fakeJev(
	answer: (
		state: State,
		questions: Record<string, Question>,
	) => Record<string, Answer>,
): { jev: Jev; calls: number[] } {
	const calls: number[] = [];
	const jev = new Jev("key", {
		fetch: async (_url, init) => {
			const body = JSON.parse(init.body as string);
			calls.push(Object.keys(body.questions).length);
			return Response.json({
				answers: answer(body.state, body.questions),
			});
		},
	});
	return { jev, calls };
}

const noul = (value: number): Answer => ({ type: "noul", noul: value });
