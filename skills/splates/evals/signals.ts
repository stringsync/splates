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
			"For a fact outside its own process (a deploy, a site), fire or wait on a named signal with --timeout and --description, then end the turn; never poll in a background loop.",
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
			"When only a check can see the fact, attach `splates signal poll <name> --interval --timeout --description -- <script>`, then wait on the same name.",
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
				about: "ran `splates signal poll` with the script after `--`",
				test: ({ commands }) =>
					commands.some(
						(command) =>
							/splates signal (poll|probe)\b/.test(command) &&
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
	{
		id: "signals/wait-on-npm-release",
		aspect,
		requirement:
			"For a fact outside its own process (a library reaching npm), wait on a named signal with --timeout and --description; never poll the registry.",
		async seed(repo) {
			await repo.write(
				"package.json",
				'{"name":"eval-vexml","private":true,"type":"module","dependencies":{"mdom":"2.3.0"}}\n',
			);
		},
		message:
			"vexml needs the new mdom that's publishing right now. Bump vexml's mdom dependency to 2.4.0 as soon as it's on npm.",
		checks: [
			{
				id: "waited",
				about:
					"ran `splates signal wait` on an mdom signal with --timeout and --description",
				test: ({ commands }) =>
					commands.some(
						(command) =>
							/splates signal wait\s+\S*mdom/.test(command) &&
							command.includes("--timeout") &&
							command.includes("--description"),
					),
			},
			{
				id: "no-polling",
				about: "polled with no loop, sleep or watch around npm view or curl",
				test: ({ commands }) =>
					!commands.some(
						(command) =>
							/npm (view|info|show)|curl|wget/.test(command) && polls(command),
					) && !commands.some((command) => /^\s*(sleep|watch)\b/.test(command)),
			},
			{
				id: "bump-waits",
				about: "did not set mdom to 2.4.0 before waking",
				test: async ({ repo }) =>
					!(await repo.run(["cat", "package.json"])).includes("2.4.0"),
			},
		],
		limits: { turns: 25, minutes: 10 },
	},
	{
		id: "signals/clock-for-later",
		aspect,
		requirement:
			"Work for later waits on a clock call (`clock.in`, `clock.at`) with --timeout and --description, not on sleep, at or cron.",
		async seed(repo) {
			await repo.write(
				"export.ts",
				'export const legacy = process.env.FLAGS?.includes("legacy-export") ?? false;\n',
			);
		},
		message:
			"Remind me in 2 days to delete the `legacy-export` flag, and check then whether anything still reads it.",
		checks: [
			{
				id: "clock",
				about:
					"ran `splates signal wait` on clock.in or clock.at with --timeout and --description",
				test: ({ commands, transcript }) => {
					const waited = commands.some(
						(command) =>
							/splates signal wait\s+['"]?clock\.(in|at)\(/.test(command) &&
							command.includes("--timeout") &&
							command.includes("--description"),
					);
					if (waited) {
						return true;
					}
					const index = transcript.findIndex(
						(step) =>
							step.kind === "tool" && /(?:^|__)CronCreate$/i.test(step.name),
					);
					return index === -1
						? false
						: {
								pass: false,
								step: {
									index,
									observed:
										"The agent called CronCreate. A session cron ends with the session.",
								},
							};
				},
			},
			{
				id: "no-timer",
				about: "ran no sleep, at or cron",
				test: ({ commands }) =>
					!commands.some((command) =>
						/(^|[;&|]\s*)(sleep|at|crontab)\b/.test(command),
					),
			},
			{
				id: "flag-kept",
				about: "left the flag in place for now",
				test: async ({ repo }) =>
					(await repo.run(["cat", "export.ts"])).includes("legacy-export"),
			},
		],
		limits: { turns: 20, minutes: 8 },
	},
	{
		id: "signals/already-happened-since",
		aspect,
		requirement:
			"When the fact may have been fired before the wait began, the wait adds --since reaching back past when it started.",
		async seed(repo) {
			await repo.write(
				"package.json",
				'{"name":"eval-docs","private":true,"type":"module","scripts":{"smoke":"echo smoke ok"}}\n',
			);
		},
		message:
			"I pushed the docs deploy about an hour ago. When it's live, run `bun run smoke`.",
		checks: [
			{
				id: "since",
				about: "ran `splates signal wait` with --since of at least an hour",
				test: ({ commands }) =>
					commands.some((command) => {
						if (!/splates signal wait\b/.test(command)) {
							return false;
						}
						const since = command.match(
							/--since[= ]['"]?(\S+?)['"]?(\s|$)/,
						)?.[1];
						if (since === undefined) {
							return false;
						}
						const duration = since.match(/^(\d+)(m|h|d)$/);
						if (duration === null) {
							return !Number.isNaN(Date.parse(since));
						}
						const minutes =
							Number(duration[1]) *
							{ m: 1, h: 60, d: 1440 }[duration[2] as "m" | "h" | "d"];
						return minutes >= 60;
					}),
			},
			{
				id: "no-polling",
				about: "polled with no loop, sleep or watch",
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
		limits: { turns: 25, minutes: 10 },
	},
	{
		id: "signals/user-says-it-happened",
		aspect,
		requirement:
			"When the user says an outside fact happened, fire its signal with the payload so waiting conversations wake, with no approval.",
		message:
			"FYI, mdom 2.4.0 just landed on npm. Another agent is waiting on it.",
		checks: [
			{
				id: "fired",
				about:
					"ran `splates signal fire` on an mdom signal with --data holding 2.4.0",
				test: ({ commands }) =>
					commands.some(
						(command) =>
							/splates signal fire\s+\S*mdom/.test(command) &&
							command.includes("--data") &&
							command.includes("2.4.0"),
					),
			},
			{
				id: "no-wait",
				about: "ran no `splates signal wait`",
				test: ({ commands }) =>
					!commands.some((command) => /splates signal wait\b/.test(command)),
			},
		],
		judgeWith: "claude:sonnet",
		judge:
			"Did the reply say the signal was fired, without asking the user for permission first? Answer yes or no.",
		limits: { turns: 15, minutes: 8 },
	},
];

/** Each starts in an initialized project, so `splates add` works as the skill says. */
export const scenarios: Scenario[] = uninitialized.map((scenario) => ({
	...scenario,
	initialized: true,
}));

export const sandbox = splatesSandbox(scenarios);
