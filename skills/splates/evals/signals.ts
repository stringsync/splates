import {
	firstStep,
	noFailedSplatesCommands,
	noPolling,
	noUnrelatedReferences,
	readReference,
	reference,
	untouched,
	withinToolCalls,
} from "./checks";
import { splatesSandbox } from "./sandbox";
import { describe, it, type Scenario } from "./scenario";

const aspect = "splates/signals";

/** The references the core loop may read in any task. */
const CORE = ["proposing.md", "questions.md", "waiting.md"];

const SEED = '{\n\t"name": "app",\n\t"type": "module"\n}\n';

export const scenarios: Scenario[] = describe("splates skill", [
	describe("signals", [
		it("tidies stale signals with splates signal cleanup", {
			key: `${aspect}/cleanup`,
			initialized: true,
			detail:
				"Asked to clear dead signals off the Signals page, the agent reads `signals.md` and runs `splates signal cleanup`, reporting what was hidden. It writes no polling loop, schedules no cleanup agent and edits no signals file by hand.",
			message: "The Signals page is full of dead signals, clear them.",
			environment: "An initialized splates repo, all committed.",
			example: [
				{
					kind: "tool",
					name: "Read",
					input: ".agents/skills/splates/references/signals.md",
					does: "Reads the cleanup section of `signals.md`.",
				},
				{
					kind: "tool",
					name: "Bash",
					input: "splates signal cleanup",
					does: "Runs the server's idle-signal sweep now.",
				},
				{
					kind: "text",
					text: "Ran the cleanup: signals nothing has listened to for a day are hidden from the Signals page, and any can be revived for 30 days.",
				},
			],
			seed: async (repo) => {
				await repo.write("package.json", SEED);
			},
			expect: [
				{
					id: "ran-cleanup",
					about: "Ran `splates signal cleanup`.",
					test: ({ commands }) => commands.some(isCleanup),
				},
				{
					id: "no-diy-cleanup",
					about:
						"Wrote no polling loop, scheduled no cleanup agent and edited no signals file by hand.",
					test: ({ commands }) => !commands.some(diyCleanup),
				},
				noUnrelatedReferences([...CORE, "signals.md"]),
				withinToolCalls(10),
			],
			limits: { turns: 12, minutes: 4 },
		}),
		it("brings a hidden signal back with splates signal revive", {
			key: `${aspect}/revive`,
			initialized: true,
			detail:
				"Asked to bring back a signal that disappeared from the Signals page, the agent reads `signals.md` and runs `splates signal revive vexml.behind-bars-pdf`, rather than re-creating the signal, editing a signals file by hand or polling.",
			message: "#vexml.behind-bars-pdf disappeared, bring it back.",
			environment: "An initialized splates repo, all committed.",
			example: [
				{
					kind: "tool",
					name: "Read",
					input: ".agents/skills/splates/references/signals.md",
					does: "Reads `signals.md` on seeing the `#vexml.behind-bars-pdf` reference.",
				},
				{
					kind: "tool",
					name: "Bash",
					input: "splates signal revive vexml.behind-bars-pdf",
					does: "Revives the hidden signal.",
				},
				{
					kind: "text",
					text: "Revived `#vexml.behind-bars-pdf`; it is back on the Signals page.",
				},
			],
			seed: async (repo) => {
				await repo.write("package.json", SEED);
			},
			expect: [
				{
					id: "ran-revive",
					about: "Ran `splates signal revive vexml.behind-bars-pdf`.",
					test: ({ commands }) =>
						commands.some((cmd) =>
							/\bsplates["']?\s+signal\s+revive\s+["']?vexml\.behind-bars-pdf\b/.test(
								cmd,
							),
						),
				},
				{
					id: "no-diy-revive",
					about:
						"Wrote no polling loop, scheduled no agent and edited no signals file by hand.",
					test: ({ commands }) => !commands.some(diyCleanup),
				},
				noUnrelatedReferences([...CORE, "signals.md"]),
				withinToolCalls(10),
			],
			limits: { turns: 12, minutes: 4 },
		}),
		it("waits on a referenced signal instead of acting early", {
			key: "splates/context-budget/signal-ref",
			initialized: true,
			detail:
				"A `#<project>.<name>` reference sends the agent to `signals.md` before any other reference, and it waits on that exact signal with `splates signal wait` instead of acting or polling.",
			message: "Once #app.deploy-done fires, bump the version in package.json.",
			environment:
				"An initialized splates repo, all committed, with `package.json` at version `1.0.0`.",
			example: [
				{
					kind: "tool",
					name: "Read",
					input: ".agents/skills/splates/references/signals.md",
					does: "Reads `signals.md` first on seeing `#app.deploy-done`.",
				},
				{
					kind: "tool",
					name: "Bash",
					input: "splates signal wait app.deploy-done",
					does: "Waits on `app.deploy-done` instead of polling or editing `package.json` early.",
				},
				{
					kind: "text",
					text: "Waiting on `#app.deploy-done` before bumping the version in `package.json`.",
				},
			],
			seed: async (repo) => {
				await repo.write(
					"package.json",
					'{\n\t"name": "app",\n\t"version": "1.0.0",\n\t"type": "module"\n}\n',
				);
			},
			expect: [
				{
					id: "signals-first",
					about: "Read signals.md before any other reference file.",
					test: ({ transcript }) => {
						const signals = firstStep(transcript, reference("signals.md"));
						const other = firstStep(
							transcript,
							(text) =>
								/references\/[a-z0-9-]+\.md/.test(text) &&
								!text.includes("references/signals.md"),
						);
						return signals >= 0 && (other === -1 || signals < other);
					},
				},
				{
					id: "waited-on-signal",
					about: "Ran `splates signal wait app.deploy-done`.",
					test: ({ commands }) =>
						commands.some((cmd) =>
							/\bsplates["']?\s+signal\s+wait\s+["']?app\.deploy-done\b/.test(
								cmd,
							),
						),
				},
				untouched("package.json"),
				noPolling(),
				noFailedSplatesCommands(),
				noUnrelatedReferences([...CORE, "signals.md"]),
			],
			limits: { turns: 16, minutes: 5 },
		}),
		it(
			"waits on the quota signal for an agent instead of writing a poll script",
			{
				key: "splates/context-budget/signal-quota",
				initialized: true,
				detail:
					'When the user wants to act once an agent\'s quota is low or has reset, read `signals.md` and wait on `quota.low("claude")` or `quota.restored("claude")` with `splates signal wait`, naming the agent, never a script that polls usage.',
				message:
					"Once my claude quota resets, bump the version in package.json to 1.1.0.",
				environment:
					"An initialized splates repo, all committed, with `package.json` at version `1.0.0`.",
				example: [
					{
						kind: "tool",
						name: "Read",
						input: ".agents/skills/splates/references/signals.md",
						does: "Reads `signals.md` to find the quota signals.",
					},
					{
						kind: "tool",
						name: "Bash",
						input:
							'splates signal wait \'quota.restored("claude")\' --timeout 7d --description "Claude\'s plan quota has reset, so the version bump can go ahead."',
						does: "Waits on `quota.restored` for `claude` instead of polling usage.",
					},
					{
						kind: "text",
						text: "Waiting for your claude quota to reset before bumping `package.json` to 1.1.0.",
					},
				],
				seed: async (repo) => {
					await repo.write(
						"package.json",
						'{\n\t"name": "app",\n\t"version": "1.0.0",\n\t"type": "module"\n}\n',
					);
				},
				expect: [
					readReference("signals.md"),
					{
						id: "waited-on-quota-restored",
						about:
							"Ran `splates signal wait` on `quota.restored` naming `claude`.",
						test: ({ commands }) =>
							commands.some((cmd) =>
								/\bsplates["']?\s+signal\s+wait\s+["']?quota\.restored\(\s*\\?["']?claude\b/.test(
									cmd,
								),
							),
					},
					untouched("package.json"),
					noPolling(),
					noFailedSplatesCommands(),
					noUnrelatedReferences([...CORE, "signals.md"]),
				],
				limits: { turns: 16, minutes: 5 },
			},
		),
	]),
]);

export const sandbox = splatesSandbox(scenarios);

const isCleanup = (cmd: string) =>
	/\bsplates["']?\s+signal\s+cleanup\b/.test(cmd);

/** A shell command that polls, schedules a cleanup, or edits signals.json itself. */
function diyCleanup(cmd: string): boolean {
	return (
		/\b(?:sleep|watch)\b|\b(?:while|until)\b/.test(cmd) ||
		/\b(?:cron|crontab|launchctl|schedule)\b/.test(cmd) ||
		/signals?\.json/.test(cmd)
	);
}
