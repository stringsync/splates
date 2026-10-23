import { afterEach, beforeEach, describe, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { NodePs } from "webappwiz/system";
import { SERVING } from "../server/shared";
import { Pty } from "./pty";
import { written } from "./testing";

describe("Pty under a server that serves", () => {
	let shell: Pty;
	let cwd: string;
	let out: string;

	beforeEach(async () => {
		cwd = await realpath(await mkdtemp(`${tmpdir()}/splates-pty-`));
		shell = new Pty({
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
		out = "";
		const decoder = new TextDecoder();
		shell.events.on("data", (bytes) => {
			out += decoder.decode(bytes, { stream: true });
		});
	});

	afterEach(async () => {
		await shell.disposeAsync();
		await rm(cwd, { recursive: true, force: true });
	});

	it("leaves out that splates server serves, so one run in it supervises itself", async () => {
		shell.write(`echo serving:\${${SERVING}-unset}\n`);

		await written(() => out, "serving:unset");
	});
});
