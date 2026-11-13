import { join, relative } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { Outcome, Repo } from "@evals/evals/scenario";
import { splatesSandbox } from "./sandbox";
import type { Scenario } from "./scenario";

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

/** The task's `## After` section. */
async function verificationOf(repo: Repo, name: string): Promise<string> {
	const plan = await repo.run(["splates", "show", name]);
	return plan.split("## After")[1]?.split(/\n## /)[0] ?? "";
}

/** A script that stands in for a screenshot tool: writes capture.png beside it. */
const CAPTURE_SCRIPT = `await Bun.write("capture.png", Buffer.from("${PNG}", "base64"));\n`;

/** Whether the reply embeds an image that `splates attach` returned and After keeps too. */
function deliveredAndKept(
	reply: string,
	transcript: Outcome["transcript"],
	verification: string,
): { inline: boolean; kept: boolean } {
	const inline = deliveredImages(reply).filter((path) =>
		transcript.some(
			(step) =>
				step.kind === "tool" &&
				/attached \d+ file/.test(stripVTControlCharacters(step.output ?? "")) &&
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
			"Attach screenshots, embed the returned stored path in the reply, and keep the same image under task After. Tool previews and plain paths are insufficient.",
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
								/attached \d+ file/.test(
									stripVTControlCharacters(step.output ?? ""),
								) &&
								step.output?.includes(path),
						),
					),
			},
			{
				id: "task-evidence",
				about: "task After embeds the same stored screenshot as the reply",
				live: true,
				async test({ repo, reply }) {
					const plan = await repo.run(["splates", "show", "screenshot"]);
					const verification =
						plan.split("## After")[1]?.split(/\n## /)[0] ?? "";
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
			"A screenshot the agent captures while verifying a change is attached with `splates attach`, embedded in the reply by its stored path, and kept under task After; the capture's own path or preview does not reach the user.",
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
				about: "task After embeds the same stored screenshot",
				live: true,
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
			"Before asking for a visual review, deliver the screenshot: the Ready to merge reply embeds the attached image, and After keeps it. A filename or `see screenshot` does not count.",
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
				about: "task After embeds the same stored screenshot",
				live: true,
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
			"Pass when the Ready to merge reply embeds the screenshot as Markdown image syntax (`![alt](path)`, the path possibly in angle brackets) outside a code block, with the stored path `splates attach` returned, and After embeds it too. Do not judge whether the path would render for the user, how the Demo line is worded, or whether the image appears once or twice: embedding it that way is the delivery. Fail only when the reply merely names the file, links it without `!`, puts the image inside a code block, or says to look at a screenshot.",
	},
	{
		id: "delivery/unprompted-visual-review",
		aspect: "delivery",
		initialized: true,
		requirement:
			"A non-trivial visible change ends on the Ready to merge card with an attached screenshot, without a merge, even when the message never mentions review, screenshots or merging.",
		async change(repo) {
			await startTask(repo, "ui", "Change the page header layout", {
				"page.html": "<header><h1>Title</h1></header>\n",
				"capture.ts": CAPTURE_SCRIPT,
			});
		},
		message:
			"In the ui task, make the page header a two-column layout with the title on the left and a nav on the right, then run `bun capture.ts` in its worktree to check how it looks.",
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
				about: "task After embeds the same stored screenshot",
				live: true,
				async test({ repo, reply, transcript }) {
					return deliveredAndKept(
						reply,
						transcript,
						await verificationOf(repo, "ui"),
					).kept;
				},
			},
			{
				id: "not-merged",
				about: "did not run splates merge or remove",
				test: ({ commands }) =>
					!commands.some(
						(command) =>
							command.includes("splates merge") ||
							command.includes("splates remove"),
					),
			},
		],
		judge:
			"Pass when the Ready to merge reply embeds the screenshot as Markdown image syntax (`![alt](path)`, the path possibly in angle brackets) outside a code block, with the stored path `splates attach` returned, and After embeds it too. Do not judge how the Demo line is worded or whether the image appears once or twice. Fail only when the reply merely names the file, links it without `!`, puts the image inside a code block, or says to look at a screenshot.",
	},
	{
		id: "delivery/unprompted-trivial-merges",
		aspect: "delivery",
		initialized: true,
		requirement:
			"A trivial change (a typo or a label) may merge without asking for review, even though the message does not mention merging.",
		async change(repo) {
			await startTask(repo, "ui", "Fix a typo in the heading", {
				"page.html": "<h1>Welcom</h1>\n",
			});
		},
		message: "In the ui task, fix the typo 'Welcom' to 'Welcome' in page.html.",
		checks: [
			{
				id: "typo-fixed",
				about: "the task's page.html says Welcome",
				live: true,
				async test({ repo }) {
					const tree = (
						await repo.run(["splates", "path", "ui"]).catch(() => "")
					).trim();
					const file = tree
						? join(tree, "page.html")
						: join(repo.dir, "page.html");
					return (await Bun.file(file).text()).includes("Welcome");
				},
			},
			{
				id: "merged-or-ready",
				about: "ran splates merge with --message, or asked for review",
				test: ({ commands, reply }) =>
					commands.some(
						(command) =>
							command.includes("splates merge") &&
							command.includes("--message"),
					) || /^## 🔍 Ready to merge ui onto /m.test(reply),
			},
		],
	},
];

export const sandbox = splatesSandbox(scenarios);
