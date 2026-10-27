import { describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { KIMI_ARGV, KIMI_CLI } from "./kimi";

/** What `KIMI_ARGV` prints when the `kimi` it finds echoes its arguments. */
async function run(
	env: Record<string, string>,
	argv = KIMI_ARGV,
): Promise<string> {
	const child = Bun.spawn(argv, {
		env: { PATH: "/usr/bin:/bin", ...env },
		stdout: "pipe",
	});
	return (await new Response(child.stdout).text()).trim();
}

describe("KIMI_ARGV", () => {
	it("starts kimi acp from KIMI_PATH, else the installer's place", async () => {
		const home = await mkdtemp(`${tmpdir()}/kimi-`);
		await mkdir(`${home}/.kimi-code/bin`, { recursive: true });
		const kimi = `${home}/.kimi-code/bin/kimi`;
		await writeFile(kimi, '#!/bin/sh\necho installed "$@"\n');
		await chmod(kimi, 0o755);
		expect(await run({ HOME: home })).toBe("installed acp");
		expect(await run({ HOME: home, KIMI_PATH: "/bin/echo" })).toBe("acp");
	});

	it("runs the same kimi with any arguments as KIMI_CLI", async () => {
		const home = await mkdtemp(`${tmpdir()}/kimi-`);
		await mkdir(`${home}/.kimi-code/bin`, { recursive: true });
		const kimi = `${home}/.kimi-code/bin/kimi`;
		await writeFile(kimi, '#!/bin/sh\necho installed "$@"\n');
		await chmod(kimi, 0o755);
		expect(await run({ HOME: home }, [...KIMI_CLI, "provider", "list"])).toBe(
			"installed provider list",
		);
	});
});
