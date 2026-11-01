import { join, relative } from "node:path";
import type { Outcome, Repo } from "@evals/evals/scenario";
import type { Scenario } from "../box";

/** Whether a reply embeds an absolute image path outside fenced code. */
export function deliveredImages(text: string): string[] {
	return [
		...text
			.replace(/```[\s\S]*?```/g, "")
			.matchAll(/!\[[^\]]*\]\(<?(\/[^\n)>]+)>?\)/g),
	].map((match) => match[1] as string);
}

const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";

/** Starts task `name` and returns its worktree, where `files` are written. */
async function startTask(
	repo: Repo,
	name: string,
	goal: string,
	files: Record<string, string>,
): Promise<void> {
	await repo.run(["splates", "add", name, "--goal", goal]);
	const tree = (await repo.run(["splates", "path", name])).trim();
	for (const [file, text] of Object.entries(files)) {
		await repo.write(relative(repo.dir, join(tree, file)), text);
	}
}

/** The task's `## Verification` section. */
async function verificationOf(repo: Repo, name: string): Promise<string> {
	const plan = await repo.run(["splates", "show", name]);
	return plan.split("## Verification")[1]?.split(/\n## /)[0] ?? "";
}

/** A script that stands in for a screenshot tool: writes capture.png beside it. */
const CAPTURE_SCRIPT = `await Bun.write("capture.png", Buffer.from("${PNG}", "base64"));\n`;

/** Whether the reply embeds an image that `splates attach` returned and Verification keeps too. */
function deliveredAndKept(
	reply: string,
	transcript: Outcome["transcript"],
	verification: string,
): { inline: boolean; kept: boolean } {
	const inline = deliveredImages(reply).filter((path) =>
		transcript.some(
			(step) =>
				step.kind === "tool" &&
				/attached \d+ file/.test(step.output ?? "") &&
				step.output?.includes(path),
		),
	);
	return {
		inline: inline.length > 0,
		kept: inline.some((path) => deliveredImages(verification).includes(path)),
	};
}

/** Delivery matters even when the agent already inspected the screenshot. */
export const scenarios: Scenario[] = [
	{
		id: "delivery/screenshot",
		aspect: "delivery",
		initialized: true,
		requirement:
			"Attach screenshots, embed the returned stored path in the reply, and keep the same image under task Verification. Tool previews and plain paths are insufficient.",
		async change(repo) {
			await repo.run([
				"splates",
				"add",
				"screenshot",
				"--goal",
				"Review the captured screenshot",
			]);
			const tree = (await repo.run(["splates", "path", "screenshot"])).trim();
			await repo.write(
				relative(repo.dir, join(tree, "capture.base64")),
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
			);
			await repo.run([
				"bun",
				"-e",
				`await Bun.write(${JSON.stringify(join(tree, "capture.png"))}, Buffer.from(await Bun.file(${JSON.stringify(join(tree, "capture.base64"))}).text(), "base64"))`,
			]);
		},
		message:
			"The screenshot task already has capture.png in its worktree. Show me that capture and keep it with the task evidence. Leave the task open for my review; do not merge or remove it.",
		checks: [
			{
				id: "attached-inline",
				about: "reply embeds a stored screenshot whose path attach returned",
				test: ({ reply, transcript }) =>
					deliveredImages(reply).some((path) =>
						transcript.some(
							(step) =>
								step.kind === "tool" &&
								/attached \d+ file/.test(step.output ?? "") &&
								step.output?.includes(path),
						),
					),
			},
			{
				id: "task-evidence",
				about:
					"task Verification embeds the same stored screenshot as the reply",
				async test({ repo, reply }) {
					const plan = await repo.run(["splates", "show", "screenshot"]);
					const verification =
						plan.split("## Verification")[1]?.split(/\n## /)[0] ?? "";
					return deliveredImages(reply).some((path) =>
						deliveredImages(verification).includes(path),
					);
				},
			},
		],
	},
	{
		id: "delivery/captured-itself",
		aspect: "delivery",
		initialized: true,
		requirement:
			"A screenshot the agent captures while verifying a change is attached with `splates attach`, embedded in the reply by its stored path, and kept under task Verification; the capture's own path or preview does not reach the user.",
		async change(repo) {
			await startTask(repo, "ui", "Change the page title", {
				"page.html": "<h1>Old title</h1>\n",
				"capture.ts": CAPTURE_SCRIPT,
			});
		},
		message:
			"In the ui task, change the title in page.html to New title, then run `bun capture.ts` in its worktree to capture the page and show me how it looks. Leave the task open; do not merge or remove it.",
		checks: [
			{
				id: "attached-inline",
				about: "reply embeds a stored screenshot whose path attach returned",
				test: ({ reply, transcript }) =>
					deliveredAndKept(reply, transcript, "").inline,
			},
			{
				id: "task-evidence",
				about: "task Verification embeds the same stored screenshot",
				async test({ repo, reply, transcript }) {
					return deliveredAndKept(
						reply,
						transcript,
						await verificationOf(repo, "ui"),
					).kept;
				},
			},
		],
	},
	{
		id: "delivery/review-shows-screenshot",
		aspect: "delivery",
		initialized: true,
		requirement:
			"Before asking for a visual review, deliver the screenshot: the Ready to merge reply embeds the attached image, and Verification keeps it. A filename or `see screenshot` does not count.",
		async change(repo) {
			await startTask(repo, "ui", "Change the page title", {
				"page.html": "<h1>New title</h1>\n",
				"capture.png": "",
			});
			const tree = (await repo.run(["splates", "path", "ui"])).trim();
			await repo.run([
				"bun",
				"-e",
				`await Bun.write(${JSON.stringify(join(tree, "capture.png"))}, Buffer.from("${PNG}", "base64"))`,
			]);
		},
		message:
			"The ui task is done: page.html has the new title and capture.png in its worktree is how the page looks. I want to eyeball it before it lands, so ask me for the review. Do not merge or remove it.",
		checks: [
			{
				id: "review-title",
				about: "reply carries the Ready to merge title",
				test: ({ reply }) => /^## 🔍 Ready to merge ui onto /m.test(reply),
			},
			{
				id: "attached-inline",
				about: "review embeds a stored screenshot whose path attach returned",
				test: ({ reply, transcript }) =>
					deliveredAndKept(reply, transcript, "").inline,
			},
			{
				id: "task-evidence",
				about: "task Verification embeds the same stored screenshot",
				async test({ repo, reply, transcript }) {
					return deliveredAndKept(
						reply,
						transcript,
						await verificationOf(repo, "ui"),
					).kept;
				},
			},
		],
		judge:
			"Pass when the review shows the screenshot as an embedded image the user can see. Fail when it only names the file, links it, or says to look at a screenshot.",
	},
];
