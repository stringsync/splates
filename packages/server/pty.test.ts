import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { NodePs } from "webappwiz/system";
import { Pty } from "./pty";
import { SERVING } from "./supervise";

describe("Pty", () => {
	let cwd: string;
	let pty: Pty;
	let screen: string;

	beforeEach(async () => {
		cwd = await realpath(await mkdtemp(`${tmpdir()}/splates-pty-`));
		pty = new Pty({
			argv: ["/bin/sh"],
			cwd,
			cols: 80,
			rows: 24,
			env: { PS1: "$ " },
		});
		screen = "";
		const decoder = new TextDecoder();
		pty.events.on("data", (bytes) => {
			screen += decoder.decode(bytes, { stream: true });
		});
	});

	afterEach(() => pty.disposeAsync());

	/** Waits for the shell to have written `text`, up to a few seconds. */
	const shows = (text: string) => written(() => screen, text);

	it("runs the shell in the directory it was given", async () => {
		pty.write("echo at:$(pwd)\n");

		await shows(`at:${cwd}`);
	});

	it("tells the shell its new size", async () => {
		pty.resize(120, 40);
		pty.write("stty size\n");

		await shows("40 120");
	});

	it("interrupts the job in front on ^C", async () => {
		pty.write("sleep 30\n");
		await Bun.sleep(200);
		pty.write("\x03");
		// The quotes keep the command the terminal echoes from reading as its output.
		pty.write('echo n""ext\n');

		// Long before the sleep would have ended on its own.
		await shows("next");
	});

	it("passes a resize on to the job in front", async () => {
		pty.write("trap 'echo resized' WINCH\n");
		await shows("$ ");
		pty.resize(100, 30);

		await shows("resized");
	});

	it("says when the shell exits, with its code", async () => {
		const exited = new Promise<number>((resolve) =>
			pty.events.on("exit", resolve),
		);
		pty.write("exit 3\n");

		expect(await exited).toBe(3);
	});

	it("leaves out that splates server serves, so one run in it supervises itself", async () => {
		const shell = new Pty({
			argv: ["/bin/sh"],
			cwd,
			cols: 80,
			rows: 24,
			env: { PS1: "$ " },
			// As the page's terminals inherit it from the server.
			ps: new NodePs({
				proc: { ...process, env: { ...process.env, [SERVING]: "1" } },
			}),
		});
		let out = "";
		const decoder = new TextDecoder();
		shell.events.on("data", (bytes) => {
			out += decoder.decode(bytes, { stream: true });
		});
		try {
			shell.write(`echo serving:\${${SERVING}-unset}\n`);
			await written(() => out, "serving:unset");
		} finally {
			await shell.disposeAsync();
		}
	});
});

/** Waits for what `screen` reads to hold `text`, up to a few seconds. */
async function written(screen: () => string, text: string): Promise<void> {
	for (let i = 0; i < 300 && !screen().includes(text); i++) {
		await Bun.sleep(10);
	}
	expect(screen()).toContain(text);
}
