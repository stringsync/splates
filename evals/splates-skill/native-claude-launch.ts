import { spawn } from "node:child_process";
import { awaitProcessGroupExit } from "./process-group";

/** Injectable process boundary. Completion must include drained output and owned descendants. */
export interface ClaudeProcess {
	completed: Promise<number>;
	cancel(): void;
}
export type ClaudeLaunch = (options: {
	argv: string[];
	cwd: string;
	env: Record<string, string>;
	input: string;
	stdout(text: string): void;
}) => ClaudeProcess;

export const launchClaude: ClaudeLaunch = ({
	argv,
	cwd,
	env,
	input,
	stdout,
}) => {
	const child = spawn(argv[0] as string, argv.slice(1), {
		cwd,
		env,
		detached: true,
		stdio: "pipe",
	});
	let stopped = false;
	const cancel = () => {
		if (stopped) {
			return;
		}
		stopped = true;
		if (child.pid !== undefined) {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				/* The process can exit between checking its pid and signalling it. */
			}
		}
	};
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", stdout);
	// Drain stderr without persisting possible native auth diagnostics/secrets.
	child.stderr.resume();
	child.stdin.on("error", () => {});
	child.stdin.end(input);
	const completed = new Promise<number>((resolve) => {
		child.once("error", () => {}); // close follows failed spawn as well
		child.once("exit", cancel); // descendants may still hold the output pipes
		child.once("close", (code) => {
			cancel();
			resolve(code ?? 127);
		});
	}).then(async (code) => {
		await awaitProcessGroupExit(child.pid);
		return code;
	});
	return { completed, cancel };
};
