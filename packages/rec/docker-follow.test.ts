import { expect, test } from "bun:test";
import type { Child, Ps } from "core/system";
import { Duration, sleep } from "core/time";
import { followContainer } from "./docker";

test("a followed container that dies is marked and followed again when it runs", async () => {
	const script = { running: true, starts: [] as string[][] };
	const { ps, die } = fakePs(script);
	const lines: string[] = [];
	const states: string[] = [];
	const follow = followContainer({
		ps,
		container: { id: "a1", name: "web", project: "mono" },
		now: () => 1000,
		observer: {
			line: (_at, text) => lines.push(text),
			state: (state) => states.push(state),
		},
		retry: Duration.ms(10),
	});
	await sleep(Duration.ms(30));
	script.running = false;
	die();
	await sleep(Duration.ms(60));
	expect(lines).toEqual(["[rec] web stopped"]);
	expect(states.at(-1)).toBe("stopped");
	script.running = true;
	await sleep(Duration.ms(60));
	expect(lines.at(-1)).toBe("[rec] web is running again");
	expect(script.starts).toHaveLength(2);
	expect(states.at(-1)).toBe("following");
	follow.dispose();
});

/** A Ps whose `docker logs` children end when told, and whose inspect answers from `running`. */
function fakePs(script: { running: boolean; starts: string[][] }) {
	const enders: (() => void)[] = [];
	const ps = {
		cwd: () => "/x/mono",
		spawnCapture: async (argv: string[]) => {
			if (argv[1] === "ps") {
				return { exitCode: 0, stdout: "a1\tweb\tmono\n", stderr: "" };
			}
			return {
				exitCode: 0,
				stdout: script.running ? "true\n" : "false\n",
				stderr: "",
			};
		},
		start: (argv: string[]) => {
			script.starts.push(argv);
			let end: () => void = () => {};
			const exited = new Promise<number>((resolve) => {
				end = () => resolve(0);
			});
			enders.push(end);
			const empty = () =>
				new ReadableStream<Uint8Array>({
					start: (controller) => {
						void exited.then(() => controller.close());
					},
				});
			return {
				pid: 1,
				stdout: empty(),
				stderr: empty(),
				exited,
				kill: end,
			} as unknown as Child;
		},
	} as unknown as Ps;
	return { ps, die: () => enders.pop()?.() };
}
