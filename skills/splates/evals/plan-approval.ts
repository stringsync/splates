import { stretches } from "@splates/server/plans";
import { mergeCmd, untouched } from "./checks";
import { splatesSandbox } from "./sandbox";
import { describe, it, type Scenario } from "./scenario";

export const scenarios: Scenario[] = describe("splates skill", [
	describe("reading plan approval replies", [
		it("asks for approval again when the reply answers only another question", {
			key: "splates/unticked-approval-replans",
			initialized: true,
			environment:
				"An open `page-status` task with `page-index.ts` and a prior Plan card asking how to record page 44 and whether to add page status.",
			message: `In the open page-status task, your last reply was:

${pagePlan()}

My reply:

> **Should p. 44 be blank?**

- (a) Record it as blank`,
			example: [
				{
					kind: "text",
					text: `## 📝 Plan: Record page status

**Goal:** The index drops page status, so readers cannot tell which pages are blank.
**After:** The index will record page 44 as blank.
**Approach:** Add a status field to each page entry and mark page 44 as blank.

1. Do you approve adding page status to the index?
   - (a) Yes, approve it
   - (b) No`,
				},
			],
			seed: async (repo) => {
				await repo.write(
					"page-index.ts",
					'export const pages = [{ number: 43, title: "Introduction" }, { number: 44, title: "" }];\n',
				);
			},
			change: async (repo) => {
				await repo.run([
					"splates",
					"add",
					"page-status",
					"--goal",
					"Record page status in the index",
				]);
			},
			expect: [
				{
					id: "renewed-approval-question",
					about:
						"The reply ends with a revised Plan card and an unselected approval question.",
					test: ({ reply }) => {
						const parts = stretches(reply);
						const card = parts.at(-1);
						const question =
							card?.type === "questions" ? card.questions.at(-1) : undefined;
						return (
							parts.some((part) => part.type === "plan") &&
							question !== undefined &&
							/^do you approve\b/i.test(question.text) &&
							question.choices.every((choice) => !choice.chosen) &&
							question.choices.some((choice) => /^yes\b/i.test(choice.text)) &&
							question.choices.some((choice) => /^no\b/i.test(choice.text))
						);
					},
				},
				untouched("page-index.ts"),
				{
					id: "no-merge",
					about: "No splates merge runs while approval is unanswered.",
					test: ({ commands }) => !commands.some(mergeCmd),
				},
			],
			judge:
				"Does the revised plan carry forward the answer to record page 44 as blank, and does the full transcript show the agent waiting for approval without editing implementation code?",
			judgeWith: "claude:sonnet",
			limits: { turns: 16, minutes: 5 },
		}),
		it("builds with the condition stated in an explicit approval note", {
			key: "splates/unticked-approval-with-note",
			initialized: true,
			environment:
				"An open `upload-limit` task. `upload.ts` accepts every upload and `config.json` sets a 100-byte limit. A prior Plan card proposes enforcing that limit.",
			message: `In the open upload-limit task, your last reply was:

${uploadPlan()}

My reply:

> **Anything else?**

approve, but keep the limit in config`,
			example: [
				{
					kind: "text",
					text: "The upload handler enforces the size limit from config.",
				},
			],
			seed: async (repo) => {
				await repo.write("config.json", '{ "maxUploadBytes": 100 }\n');
				await repo.write(
					"upload.ts",
					"export function acceptsUpload(_bytes: number): boolean {\n\treturn true;\n}\n",
				);
			},
			change: async (repo) => {
				await repo.run([
					"splates",
					"add",
					"upload-limit",
					"--goal",
					"Reject oversized uploads",
				]);
			},
			expect: [
				{
					id: "config-controls-limit",
					about:
						"The handler accepts uploads at the configured limit and rejects larger uploads, including after the config changes.",
					live: true,
					test: async ({ repo }) => {
						try {
							await repo.run(checkUploadLimit(100));
							const original = await repo.run(["cat", "config.json"]);
							const updated = { ...JSON.parse(original), maxUploadBytes: 200 };
							await repo.write("config.json", JSON.stringify(updated));
							try {
								await repo.run(checkUploadLimit(200));
							} finally {
								await repo.write("config.json", original);
							}
							return true;
						} catch {
							return false;
						}
					},
				},
			],
			judge:
				"Does the full transcript show the agent proceeding with implementation on the explicit approval in the note, honoring the config condition without asking for approval again?",
			judgeWith: "claude:sonnet",
			limits: { turns: 24, minutes: 8 },
		}),
	]),
]);

export const sandbox = splatesSandbox(scenarios);

function pagePlan(): string {
	return `## 📝 Plan: Record page status

**Goal:** The index drops page status, so readers cannot tell which pages are blank.
**After:** Index entries include page status.
**Approach:** Add a status field to each page entry.

1. Should p. 44 be blank?
   - (a) Record it as blank (chosen)
   - (b) Mark its status unknown
2. Do you approve adding page status to the index?
   - (a) Yes, approve it
   - (b) No`;
}

function uploadPlan(): string {
	return `## 📝 Plan: Limit upload size

**Goal:** Oversized uploads are accepted and can exhaust storage.
**After:** The upload handler rejects files larger than 100 bytes.
**Approach:** Check the byte count in the existing upload handler.

1. Do you approve limiting upload size?
   - (a) Yes, approve it
   - (b) No`;
}

function checkUploadLimit(limit: number): string[] {
	return [
		"bun",
		"-e",
		`import assert from "node:assert/strict";
import { acceptsUpload } from "./upload.ts";
assert.equal(acceptsUpload(${limit}), true);
assert.equal(acceptsUpload(${limit + 1}), false);`,
	];
}
