// A ship command as a project's CLI serves one, for the engine's tests that
// run real processes: `bun ship-command.ts <request>` from a directory whose
// files say what each step did. `slow` waits on `go` before it writes
// `slow.done`, so a test can kill the server while it is mid-step; `ask`
// asks for a code and writes what it is given.
import { existsSync, writeFileSync } from "node:fs";
import { serve, step, target } from "core/ship";

const app = target({
	name: "app",
	plan: () => [
		step({
			id: "slow",
			does: "Wait for go, then mark slow done",
			done: async () => existsSync("slow.done"),
			run: async (ctx) => {
				ctx.update("waiting for go");
				await ctx.sh("while [ ! -e go ]; do sleep 0.02; done");
				writeFileSync("slow.done", "");
				ctx.update("went");
			},
		}),
		step({
			id: "ask",
			does: "Ask for a code and keep it",
			dependencies: ["slow"],
			done: async () => existsSync("code"),
			run: async (ctx) => {
				writeFileSync("code", await ctx.ask("Code?"));
			},
		}),
	],
});

await serve(app, process.argv.slice(2));
