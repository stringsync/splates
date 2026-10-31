import { describe, expect, it } from "bun:test";
import { NodePs } from "core/system";
import { readUntil } from "./testing";

describe("supervise, real processes", () => {
	it("kills a child that ignores stop signals and releases the command", async () => {
		const ps = new NodePs();
		// This disposable command serves no project and opens no server port.
		// Signal only its supervisor, as terminals do not always reach the child.
		const source = new URL("./supervise.ts", import.meta.url).href;
		const system = import.meta.resolve("core/system");
		const log = import.meta.resolve("core/log");
		const command = ps.start([
			"bun",
			"--eval",
			`
			import { NodePs } from ${JSON.stringify(system)};
			import { ConsoleLogger } from ${JSON.stringify(log)};
			import { supervise } from ${JSON.stringify(source)};
			const ps = new NodePs();
			ps.self = ["bun", "--eval", "process.on('SIGTERM', () => {}); console.log('ready:' + process.pid); setInterval(() => {}, 1000)"];
			ps.args = [];
			process.exit(await supervise(ps, { log: new ConsoleLogger() }));
		`,
		]);
		const stderr = new Response(command.stderr).text();
		const reader = command.stdout.getReader();
		let pid = 0;
		try {
			const output = await readUntil(reader, "\n");
			expect(output, output ? undefined : await stderr).toMatch(/ready:\d+/);
			pid = Number(/ready:(\d+)/.exec(output)?.[1]);
			command.kill("SIGINT");
			expect(await command.exited).toBe(130);
			expect(ps.alive(pid)).toBe(false);
		} finally {
			command.kill("SIGKILL");
			// vet-ignore matchers-over-test-logic: clean up the child even if readiness or an assertion failed
			if (pid && ps.alive(pid)) {
				await ps.spawnCapture(["kill", "-KILL", String(pid)]);
			}
			reader.releaseLock();
		}
	});
});
