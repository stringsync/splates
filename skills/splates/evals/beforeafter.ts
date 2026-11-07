import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check, Repo } from "@evals/evals/scenario";
import { stretches } from "@splates/server/plans";
import { splatesSandbox } from "./sandbox";
import type { Scenario } from "./scenario";

const aspect = "before-after";

const upload = `export async function upload(file: Uint8Array): Promise<string> {
	const id = crypto.randomUUID();
	await store.put(id, file);
	return id;
}
`;

/** The text of a `## <title>` section of a task record, without its HTML comments, or null when absent. */
export function section(notes: string, title: string): string | null {
	const found = new RegExp(
		`^## ${title}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,
		"m",
	).exec(notes);
	return found === null
		? null
		: (found[1] ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
}

/** Every task's SPLATES.md as the run left it, found through `splates list --json`. */
async function records(repo: Repo): Promise<string[]> {
	const listed = JSON.parse(await repo.run(["splates", "list", "--json"])) as {
		name?: string;
		task?: string;
	}[];
	const notes: string[] = [];
	for (const each of listed) {
		const name = each.name ?? each.task;
		if (name === undefined) {
			continue;
		}
		const path = (await repo.run(["splates", "path", name])).trim();
		notes.push(await readFile(join(path, "SPLATES.md"), "utf8"));
	}
	return notes;
}

const proposed = (reply: string) => /^## 💡 Proposed\b/m.test(reply);

const notMerged: Check = {
	id: "not-merged",
	about: "never ran `splates merge`",
	test: ({ commands }) =>
		!commands.some((command) => /\bsplates\s+merge\b/.test(command)),
};

const sourceUntouched: Check = {
	id: "source-untouched",
	about: "left src/upload.ts as it was",
	test: async ({ repo }) =>
		(await repo.run(["git", "status", "--porcelain", "--", "src"])).trim() ===
			"" &&
		(await readFile(join(repo.dir, "src/upload.ts"), "utf8")) === upload,
};

/** Before and After are written after the first look, and the proposal comes before any code. */
export const scenarios: Scenario[] = [
	{
		id: `${aspect}/concise-outcome`,
		aspect,
		initialized: true,
		requirement:
			"After contains one or two summary sentences; supporting details and check results go in later sections.",
		async change(repo) {
			await repo.run([
				"splates",
				"add",
				"upload-id",
				"--goal",
				"Upload uses a clearer local name.",
			]);
			const path = (await repo.run(["splates", "path", "upload-id"])).trim();
			await repo.write(
				join(path, "SPLATES.md").replace(`${repo.dir}/`, ""),
				"# upload-id\n\n## Before\nUpload uses an unclear local name.\n\n## After\nUpload uses a clearer local name.\n",
			);
		},
		message:
			"The upload-id task is complete. Update its SPLATES.md with the outcome and these handoff notes: renamed id to uploadId, updated the store call and return expression, checked the diff, and the focused upload test passed. Keep the task open; do not merge or change code.",
		checks: [
			{
				id: "summary-and-later-details",
				about: "After is brief plain prose and supporting sections follow it",
				live: true,
				async test({ repo }) {
					const notes = (await records(repo))[0] ?? "";
					const after = section(notes, "After") ?? "";
					return (
						after.length > 0 &&
						after.replace(/^\s*!\[.*$/gm, "").length < 400 &&
						!/^\s*(?:[-*]|```)/m.test(after.replace(/^\s*!\[.*$/gm, "")) &&
						/^## After[\s\S]*?^## /m.test(notes)
					);
				},
			},
		],
		judge:
			"Does SPLATES.md's After contain only one or two short sentences summarizing the outcome, with implementation notes and the passing focused upload test recorded in sections after After rather than packed into the summary?",
		limits: { turns: 25, minutes: 10 },
	},

	{
		id: `${aspect}/filled-after-look`,
		aspect,
		initialized: true,
		requirement:
			"A task's `## Before` and `## After` are filled in after the first look at the code, and a non-trivial change is proposed as a card, with no code, before anything is built.",
		seed: async (repo) => {
			await repo.write("src/upload.ts", upload);
		},
		message:
			"Uploads that fail halfway leave their bytes in the store forever. Make upload() delete the stored file when anything after the put fails, and add a retry of the put with backoff.",
		checks: [
			{
				id: "before-after-written",
				about:
					"the task's SPLATES.md has a non-empty Before and After that mention upload",
				live: true,
				test: async ({ repo }) =>
					(await records(repo)).some((notes) => {
						const before = section(notes, "Before");
						const after = section(notes, "After");
						return (
							before !== null &&
							after !== null &&
							before !== "" &&
							after !== "" &&
							/upload|store/i.test(`${before} ${after}`)
						);
					}),
			},
			{
				id: "proposed",
				about: "the reply is a `## 💡 Proposed` block",
				test: ({ reply }) => proposed(reply),
			},
			{
				id: "asked-as-cards",
				about: "the proposal's calls are numbered question cards",
				test: ({ reply }) =>
					stretches(reply).some((each) => each.type === "questions"),
			},
			sourceUntouched,
			notMerged,
		],
		limits: { turns: 40, minutes: 20 },
		followUp: { turns: 3, done: ({ reply }) => proposed(reply) },
	},
	{
		id: `${aspect}/trivial-skips-proposal`,
		aspect,
		initialized: true,
		requirement:
			"A trivial change, easy to revert, skips the proposal: one line says so, and the change is built.",
		seed: async (repo) => {
			await repo.write("src/upload.ts", upload);
		},
		message:
			"Rename the `id` local in upload() to `uploadId`. It is a trivial rename, so just do it and commit it in the task. Do not merge.",
		checks: [
			{
				id: "no-proposal",
				about: "the reply is no `## 💡 Proposed` block",
				test: ({ reply }) => !proposed(reply),
			},
			{
				id: "says-trivial",
				about: "a line says the change is trivial and builds directly",
				test: ({ transcript, reply }) =>
					/\btrivial\b/i.test(
						`${reply}\n${transcript
							.filter((step) => step.kind === "text")
							.map((step) => step.text)
							.join("\n")}`,
					),
			},
			{
				id: "renamed",
				about: "the task's worktree names the local uploadId",
				live: true,
				test: async ({ repo }) => {
					const listed = JSON.parse(
						await repo.run(["splates", "list", "--json"]),
					) as { name?: string; task?: string }[];
					const name = listed[0]?.name ?? listed[0]?.task;
					if (name === undefined) {
						return false;
					}
					const path = (await repo.run(["splates", "path", name])).trim();
					return (await readFile(join(path, "src/upload.ts"), "utf8")).includes(
						"uploadId",
					);
				},
			},
			notMerged,
		],
		limits: { turns: 30, minutes: 15 },
	},
	{
		id: `${aspect}/question-in-reply-only`,
		aspect,
		initialized: true,
		requirement:
			"A call only the person can make is asked once, as a numbered question in the reply, and SPLATES.md has no Blocked section.",
		seed: async (repo) => {
			await repo.write("src/upload.ts", upload);
		},
		message:
			"Add a size limit to upload(). I have not decided the limit, and it changes what customers can send, so ask me and do not guess. Propose it, don't build it.",
		checks: [
			{
				id: "asked-in-reply",
				about: "the reply asks a numbered question card",
				test: ({ reply }) =>
					stretches(reply).some(
						(each) =>
							each.type === "questions" && each.questions[0]?.number === "1",
					),
			},
			{
				id: "no-blocked",
				about: "no task's SPLATES.md has a Blocked section",
				live: true,
				test: async ({ repo }) =>
					!(await records(repo)).some((notes) => /^## Blocked\b/m.test(notes)),
			},
			sourceUntouched,
			notMerged,
		],
		limits: { turns: 40, minutes: 20 },
		followUp: { turns: 3, done: ({ reply }) => proposed(reply) },
	},
	{
		id: `${aspect}/actual-beside-expected`,
		aspect,
		initialized: true,
		requirement:
			"Before asking for a review, Verification keeps the approved mock labelled Expected and After gains the real result.",
		async change(repo) {
			await repo.run([
				"splates",
				"add",
				"upload-id",
				"--goal",
				"upload() names its local uploadId",
			]);
			const path = (await repo.run(["splates", "path", "upload-id"])).trim();
			await repo.write(
				join(path, "SPLATES.md").replace(`${repo.dir}/`, ""),
				`# upload-id

## Before

\`upload()\` names its local \`id\`.

## After

upload() names its local uploadId.

Expected:

\`\`\`
const uploadId = crypto.randomUUID();
\`\`\`
`,
			);
			await repo.write(
				join(path, "src/upload.ts").replace(`${repo.dir}/`, ""),
				upload.replaceAll("id", "uploadId"),
			);
		},
		message:
			"Task upload-id is built and committed; find its worktree with splates path upload-id. Its After holds the approved sketch. Prepare it for my review: move the sketch to Verification labelled Expected and show what was really built under After as the skill asks, then ask me to review. Do not merge.",
		checks: [
			{
				id: "expected-and-actual",
				about:
					"Verification labels the approved sketch Expected and After shows the built result",
				live: true,
				test: async ({ repo }) => {
					const path = (
						await repo.run(["splates", "path", "upload-id"])
					).trim();
					const notes = await readFile(join(path, "SPLATES.md"), "utf8");
					const verification = section(notes, "Verification");
					const after = section(notes, "After");
					return (
						verification !== null &&
						/expected/i.test(verification) &&
						after !== null &&
						/uploadId/.test(after) &&
						!/expected/i.test(after)
					);
				},
			},
			{
				id: "review-card",
				about: "the reply asks for a review of the task",
				test: ({ reply }) =>
					stretches(reply).some(
						(each) =>
							each.type === "review" && each.review.task === "upload-id",
					),
			},
			notMerged,
		],
		limits: { turns: 30, minutes: 15 },
	},
];

export const sandbox = splatesSandbox(scenarios);
