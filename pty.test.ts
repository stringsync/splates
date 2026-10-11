import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Pty } from "./pty";

describe("Pty", () => {
	let cwd: string;
	let pty: Pty;
	let screen: string;
	let exited: number | null;

	beforeEach(async () => {
		cwd = await realpath(await mkdtemp(`${tmpdir()}/arbor-pty-`));
		pty = new Pty({
			argv: ["/bin/sh"],
			cwd,
			cols: 80,
			rows: 24,
			env: { PS1: "$ " },
		});
		screen = "";
		exited = null;
		const decoder = new TextDecoder();
		pty.events.on("data", (bytes) => {
			screen += decoder.decode(bytes, { stream: true });
		});
		pty.events.on("exit", (code) => {
			exited = code;
		});
	});

	afterEach(() => pty.disposeAsync());

	/** Waits for the shell to have written `text`, up to a few seconds. */
	const shows = async (text: string) => {
		for (let i = 0; i < 300 && !screen.includes(text); i++) {
			await Bun.sleep(10);
		}
		expect(screen).toContain(text);
	};

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
		pty.write("echo next\n");

		// Long before the sleep would have ended on its own.
		await shows("\nnext");
	});

	it("passes a resize on to the job in front", async () => {
		pty.write("trap 'echo resized' WINCH\n");
		await shows("$ ");
		pty.resize(100, 30);

		await shows("resized");
	});

	it("says when the shell exits, with its code", async () => {
		pty.write("exit 3\n");

		for (let i = 0; i < 300 && exited === null; i++) {
			await Bun.sleep(10);
		}
		expect(exited).toBe(3);
	});
});
