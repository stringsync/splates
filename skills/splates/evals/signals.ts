import { splatesSandbox } from "./sandbox";
import type { Scenario } from "./scenario";

const aspect = "signals";

/** Whether `command` polls: a loop, a sleep or a watch around a check. */
function polls(command: string): boolean {
	return /\b(while|until|sleep|watch)\b/.test(command);
}

/** The signal commands the agent ran, as `[verb, name]`. */
function signalCommands(commands: string[], verb: string): string[] {
	return commands.flatMap((command) => {
		const match = command.match(
			new RegExp(`splates signal ${verb}\\s+([\\w./-]+)`),
		);
		return match?.[1] === undefined ? [] : [match[1]];
	});
}

const uninitialized: Scenario[] = [
	{
		id: "signals/wait-on-deploy",
		aspect,
		requirement:
			"For a fact outside its own process (a deploy, a site), raise or wait on a named signal with --timeout and --description, then end the turn; never poll in a background loop.",
		async seed(repo) {
			await repo.write(
				"package.json",
				'{"name":"eval-docs","private":true,"type":"module","scripts":{"deploy":"echo deploy started","smoke":"echo smoke ok"}}\n',
			);
		},
		message:
			"Kick off the staging deploy for the docs site, then once https://docs-staging.example.com is serving the new build, run the smoke test script `bun run smoke`.",
		checks: [
			{
				id: "waited",
				about: "ran `splates signal wait` with --timeout and --description",
				test: ({ commands }) =>
					commands.some(
						(command) =>
							/splates signal wait\b/.test(command) &&
							command.includes("--timeout") &&
							command.includes("--description"),
					),
			},
			{
				id: "no-polling",
				about: "polled with no loop, sleep or watch around curl",
				test: ({ commands }) =>
					!commands.some(
						(command) => /curl|wget/.test(command) && polls(command),
					) && !commands.some((command) => /^\s*(sleep|watch)\b/.test(command)),
			},
			{
				id: "smoke-waits",
				about: "did not run the smoke test before waking",
				test: ({ commands }) =>
					!commands.some((command) => /\bsmoke\b/.test(command)),
			},
		],
		judgeWith: "claude:sonnet",
		judge:
			"Did the agent end its turn after starting the wait, without claiming the site was up or the smoke test passed? Answer yes or no.",
		limits: { turns: 25, minutes: 10 },
	},
	{
		id: "signals/probe-for-check-only-fact",
		aspect,
		requirement:
			"When only a check can see the fact, attach `splates signal probe <name> --every --timeout --description -- <script>`, then wait on the same name.",
		async seed(repo) {
			await repo.write(
				"package.json",
				'{"name":"eval-stack","private":true,"type":"module","scripts":{"post-deploy":"echo post-deploy ok"}}\n',
			);
			await repo.write(
				"scripts/stack-status.sh",
				"#!/bin/sh\n# Exits 0 and prints READY once the stack has been created.\n[ -f .stack-ready ] && echo READY\n",
			);
		},
		message:
			"Our CDK stack is still creating. When `scripts/stack-status.sh` prints READY, continue and run `bun run post-deploy`.",
		checks: [
			{
				id: "probed",
				about: "ran `splates signal probe` with the script after `--`",
				test: ({ commands }) =>
					commands.some(
						(command) =>
							/splates signal probe\b/.test(command) &&
							/ -- .*stack-status\.sh/.test(command) &&
							command.includes("--every") &&
							command.includes("--timeout") &&
							command.includes("--description"),
					),
			},
			{
				id: "same-name",
				about: "waited on the signal name it probed",
				test: ({ commands }) => {
					const probed = signalCommands(commands, "probe");
					const waited = signalCommands(commands, "wait");
					return waited.some((name) => probed.includes(name));
				},
			},
			{
				id: "no-polling",
				about: "never looped over the status script itself",
				test: ({ commands }) =>
					!commands.some(
						(command) =>
							!/splates signal/.test(command) &&
							/stack-status/.test(command) &&
							polls(command),
					),
			},
			{
				id: "post-deploy-waits",
				about: "did not run post-deploy before waking",
				test: ({ commands }) =>
					!commands.some((command) => /post-deploy/.test(command)),
			},
		],
		limits: { turns: 25, minutes: 10 },
	},
	{
		id: "signals/own-command-stays-background",
		aspect,
		requirement:
			"A signal is for outside conditions only: the agent's own long command (a build) is run directly, with no signal.",
		async seed(repo) {
			await repo.write(
				"package.json",
				'{"name":"eval-build","private":true,"type":"module","scripts":{"build":"sleep 3 && echo build ok"}}\n',
			);
		},
		message: "Run the full build and then tell me whether it passed.",
		checks: [
			{
				id: "built",
				about: "ran the build itself",
				test: ({ commands }) =>
					commands.some((command) => /\b(bun|npm) run build\b/.test(command)),
			},
			{
				id: "no-signal",
				about: "ran no `splates signal` command",
				test: ({ commands }) =>
					!commands.some((command) => /splates signal\b/.test(command)),
			},
		],
		limits: { turns: 15, minutes: 8 },
	},
];

/** Each starts in an initialized project, so `splates add` works as the skill says. */
export const scenarios: Scenario[] = uninitialized.map((scenario) => ({
	...scenario,
	initialized: true,
}));

export const sandbox = splatesSandbox(scenarios);
