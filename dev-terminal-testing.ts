import { expect } from "bun:test";

/** A terminal open on `query`, with everything it has said so far. */
export async function terminal(port: number, query = "") {
	// As a page would: Bun's client sends no Origin of its own. The DOM's
	// type for the constructor does not know Bun takes options here.
	const options: Bun.WebSocketOptions = {
		headers: { origin: `http://127.0.0.1:${port}` },
	};
	const socket = new WebSocket(
		`ws://127.0.0.1:${port}/api/terminal${query}`,
		options as string[],
	);
	socket.binaryType = "arraybuffer";
	const said = { screen: "", controls: [] as unknown[], closed: false };
	const decoder = new TextDecoder();
	socket.addEventListener("message", ({ data }) => {
		if (typeof data === "string") {
			said.controls.push(JSON.parse(data));
		} else {
			said.screen += decoder.decode(data as ArrayBuffer, { stream: true });
		}
	});
	socket.addEventListener("close", () => {
		said.closed = true;
	});
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve);
		socket.addEventListener("error", reject);
	});
	/** Waits for the shell to have written `text`, up to a few seconds. */
	const shows = async (text: string) => {
		for (let i = 0; i < 300 && !said.screen.includes(text); i++) {
			await Bun.sleep(10);
		}
		expect(said.screen).toContain(text);
	};
	/**
	 * Asks what job the shell runs in front until it answers `command`, up
	 * to a few seconds, since a job takes a moment to come to the front.
	 */
	const fronts = async (command: string | null) => {
		let answer: unknown;
		for (let i = 0; i < 100 && answer !== command; i++) {
			const before = said.controls.length;
			socket.send(JSON.stringify({ type: "front" }));
			for (let j = 0; j < 300 && said.controls.length === before; j++) {
				await Bun.sleep(10);
			}
			answer = (said.controls.at(-1) as { command?: unknown }).command;
		}
		expect(said.controls.at(-1)).toEqual({ type: "front", command });
	};
	/** Waits for the server to hang up, up to a few seconds. */
	const closes = async () => {
		for (let i = 0; i < 300 && !said.closed; i++) {
			await Bun.sleep(10);
		}
	};
	return { socket, said, shows, fronts, closes };
}
