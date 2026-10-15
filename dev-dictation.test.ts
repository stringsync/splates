import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeDecider } from "webappwiz/decide/testing";
import type { DictationMessage } from "webappwiz/dictate";
import { FakeTranscriber } from "webappwiz/dictate/testing";
import { OpenPortProvider } from "webappwiz/system";
import type { CleanupModel } from "./cleanup-models";
import { dev } from "./dev";
import { type TranscriberFor, transcriberFor } from "./dev-transcriber";
import { Testing } from "./testing";

describe("dev dictation", () => {
	let deps: Testing;
	let transcriber: FakeTranscriber;
	let decider: FakeDecider;
	/** The model each take's cleanup asked to decide with. */
	let models: (CleanupModel | undefined)[];

	beforeEach(async () => {
		deps = await Testing.open();
		transcriber = new FakeTranscriber();
		decider = new FakeDecider();
		models = [];
	});

	afterEach(() => deps.disposeAsync());

	const opened = async (
		body: (port: number) => Promise<void>,
		transcribe: TranscriberFor = async () => transcriber,
	) => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			transcriber: transcribe,
			decider: async (_project, model) => {
				models.push(model);
				return decider;
			},
		});
		try {
			await body(server.port);
		} finally {
			await server.disposeAsync();
		}
	};

	/** A dictation open as the page opens one, with all it has said. */
	const dictation = async (port: number, query = "") => {
		// Bun's client sends no Origin of its own. The DOM's type for the
		// constructor does not know Bun takes options here.
		const options: Bun.WebSocketOptions = {
			headers: { origin: `http://127.0.0.1:${port}` },
		};
		const socket = new WebSocket(
			`ws://127.0.0.1:${port}/api/dictation${query}`,
			options as string[],
		);
		const said: DictationMessage[] = [];
		let closed = false;
		socket.addEventListener("message", ({ data }) => {
			said.push(JSON.parse(String(data)));
		});
		socket.addEventListener("close", () => {
			closed = true;
		});
		await new Promise((resolve, reject) => {
			socket.addEventListener("open", resolve);
			socket.addEventListener("error", reject);
		});
		/** Waits for the socket to close, up to a few seconds. */
		const ended = async () => {
			for (let i = 0; i < 300 && !closed; i++) {
				await Bun.sleep(10);
			}
			return said;
		};
		return { socket, said, ended };
	};

	it("says what it hears as the audio comes, then the final text", async () => {
		await opened(async (port) => {
			const { socket, ended } = await dictation(port);
			socket.send(new TextEncoder().encode("one "));
			socket.send(new TextEncoder().encode("two"));
			socket.send("finish");

			expect(await ended()).toEqual([
				{ type: "heard", text: "heard: one " },
				{ type: "heard", text: "heard: one two" },
				{ type: "done", text: "heard: one two", edits: [] },
			]);
		});
	});

	it("tags the systems the final text names, on the model the page picked", async () => {
		await deps.commit(
			deps.service.git.root,
			"arbor.systems.ts",
			`export default ${JSON.stringify({ scry: { globs: ["scry/**"] } })};\n`,
			"name the systems",
		);
		decider.answers = {
			"refers:scry": { type: "noul", noul: 0.99 },
			"span:0": {
				type: "choice",
				choice: "scry",
				probabilities: { scry: 0.99, none: 0.01 },
				confidence: 1,
			},
		};
		await opened(async (port) => {
			const { socket, ended } = await dictation(port, "?model=jev-latest");
			socket.send(new TextEncoder().encode("run scry"));
			socket.send("finish");

			expect((await ended()).at(-1)).toEqual({
				type: "done",
				text: "heard: run #scry",
				edits: [],
			});
			expect(models).toEqual(["jev-latest"]);
		});
	});

	it("says why the final text never came", async () => {
		transcriber.failure = new Error("OpenAI said: bad key");
		await opened(async (port) => {
			const { socket, ended } = await dictation(port);
			socket.send(new TextEncoder().encode("one"));
			socket.send("finish");

			expect((await ended()).at(-1)).toEqual({
				type: "failed",
				message: "OpenAI said: bad key",
			});
		});
	});

	it("asks for an OpenAI key on the Creds page when none is kept", async () => {
		await opened(async (port) => {
			const { ended } = await dictation(port);

			expect(await ended()).toEqual([
				{
					type: "failed",
					message: "dictation needs OPENAI_API_KEY: add it on the Creds page",
					cred: "OPENAI_API_KEY",
				},
			]);
			expect(await deps.creds.requests()).toMatchObject([
				{ name: "OPENAI_API_KEY", scope: "device", status: "open" },
			]);
		}, transcriberFor);
	});

	it("opens only from its own page", async () => {
		await opened(async (port) => {
			const response = await fetch(`http://127.0.0.1:${port}/api/dictation`, {
				headers: {
					connection: "Upgrade",
					upgrade: "websocket",
					"sec-websocket-version": "13",
					"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
					origin: "https://elsewhere.example",
				},
			});

			expect(response.status).toBe(403);
		});
	});
});
