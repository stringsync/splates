import type { Check } from "@evals/evals/scenario";
import { stretches } from "@splates/server/plans";
import { deliveredImages } from "./delivery";
import { splatesSandbox } from "./sandbox";
import type { Scenario } from "./scenario";

/** The plan card's body with fences and images taken out: the prose the word budget counts. */
export function planProse(body: string): string {
	return body
		.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "")
		.replace(/<pre[\s\S]*?<\/pre>/g, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
}

/** Whether a plan body has the prescribed shape: Goal, After and Approach lines, no step list, at most 200 words of prose. */
export function shortPlan(body: string): boolean {
	const prose = planProse(body);
	const has = (label: string) =>
		new RegExp(`^\\*\\*${label}:\\*\\*\\s*\\S`, "m").test(prose);
	const listed = /^\s*(?:[-*+]|\d+[.)])\s+\S/m.test(prose);
	const words = prose.split(/\s+/).filter((word) => /\w/.test(word)).length;
	return (
		has("Goal") && has("After") && has("Approach") && !listed && words <= 200
	);
}

const aspect = "proposing";

/** Whether a reply holds one questions card ending in the approval question. */
const approvalOnly = (reply: string) => {
	const cards = stretches(reply).filter((each) => each.type === "questions");
	const first = cards[0];
	return (
		cards.length === 1 &&
		first?.type === "questions" &&
		/^Do you approve (?!this proposal\?).+\?/.test(
			first.questions.at(-1)?.text ?? "",
		)
	);
};

/** Whether a run holds its final answer: the plan and its approval question, not a line about what comes next. */
const proposed = (run: { reply: string }) => approvalOnly(run.reply);

const titled: Check = {
	id: "proposed",
	about:
		"the reply ends in one questions card that ends in an approval question that names the change (not `this proposal`)",
	test: ({ reply }) => approvalOnly(reply),
};

const attached: Check = {
	id: "attached",
	about: "ran `splates attach` and embedded an attached image in the reply",
	test: ({ commands, reply }) =>
		commands.some((command) => /\bsplates["']?\s+attach\b/.test(command)) &&
		deliveredImages(reply).length > 0,
};

const notBuilt: Check = {
	id: "not-built",
	about: "never ran `splates merge`",
	test: ({ commands }) =>
		!commands.some((command) => /\bsplates\s+merge\b/.test(command)),
};

/** Whether a reply opens a plan card the questions after it decide. */
const planCard: Check = {
	id: "plan-card",
	about:
		"the reply holds a `## 📝 Plan:` card followed by its questions, the approval question last",
	test: ({ reply }) => {
		const cards = stretches(reply).filter((each) => each.type !== "text");
		return cards[0]?.type === "plan" && cards[1]?.type === "questions";
	},
};

const short: Check = {
	id: "short-plan",
	about:
		"the plan card holds **Goal:**, **After:** and **Approach:** lines, no step list, and at most 200 words of prose",
	test: ({ reply }) =>
		stretches(reply).some(
			(each) => each.type === "plan" && shortPlan(each.plan.body),
		),
};

const uploadService = `export async function upload(file: Uint8Array): Promise<string> {
	const id = crypto.randomUUID();
	await store.put(id, file);
	await db.insert("uploads", { id, status: "stored" });
	await queue.send({ id });
	return id;
}
`;

const settingsPage = `<!doctype html>
<html>
	<body>
		<h1>Settings</h1>
		<label>Name <input name="name" /></label>
		<label>Email <input name="email" /></label>
		<button>Save</button>
	</body>
</html>
`;

/** A plan shows its change in a picture, as the skill's Showing the change asks. */
export const scenarios: Scenario[] = [
	{
		id: `${aspect}/plan-card-over-threshold`,
		aspect,
		initialized: true,
		requirement:
			"A change spanning several services and tables is planned as a short plan card: `## 📝 Plan:`, Goal, After and Approach lines (Hard to undo when something is) with a D2 diagram and no step list, at most 200 words of prose, then its questions, the approval question last.",
		seed: async (repo) => {
			await repo.write("src/upload.ts", uploadService);
			await repo.write(
				"src/worker.ts",
				"export async function work(job: { id: string }) {\n\tawait scan(job.id);\n\tawait db.update('uploads', job.id, { status: 'clean' });\n}\n",
			);
		},
		message:
			"What do you think about retrying failed upload scans, with a dead-letter queue and a new failures table the support team can read? Plan it, don't build it.",
		checks: [
			titled,
			planCard,
			short,
			{
				id: "diagrammed",
				about: "the plan, in the reply or its page, draws the flow in D2",
				test: ({ reply }) =>
					/^```d2[ \t]*$/m.test(reply) || /\bPlan:\s*\S+\.html?/i.test(reply),
			},
			notBuilt,
		],
		judgeWith: "claude:sonnet",
		judge:
			"Does the plan say how the change gets done, not only what will be different once it is done, and does its Goal line give the reason for the change rather than restating its After line? Answer yes or no.",
		limits: { turns: 40, minutes: 20 },
		followUp: { turns: 3, done: proposed },
	},
	{
		id: `${aspect}/plan-card-for-ui`,
		aspect,
		initialized: true,
		requirement:
			"A visible frontend change is planned as a plan card with its mockup attached, in the markdown or a plan page.",
		seed: async (repo) => {
			await repo.write("settings.html", settingsPage);
		},
		message:
			"What do you think about adding a theme picker with light, dark and system options to the settings screen? Propose it, don't build it.",
		checks: [
			titled,
			planCard,
			short,
			{
				id: "mocked",
				about: "attached a mockup image, or kept a plan page holding it",
				test: ({ commands, reply }) =>
					deliveredImages(reply).length > 0 ||
					commands.some((command) =>
						/\bsplates["']?\s+artifact\s+add\b.*\.html?\b/.test(command),
					),
			},
			{
				id: "kept-clean",
				about: "left the repo's files unchanged",
				test: async ({ repo }) =>
					(await repo.run(["git", "status", "--porcelain"])).trim() === "",
			},
			notBuilt,
		],
		limits: { turns: 40, minutes: 20 },
		followUp: { turns: 3, done: proposed },
	},
	{
		id: `${aspect}/full-plan-choice`,
		aspect,
		initialized: true,
		requirement:
			"When the user answers an approval question with `Request a full plan`, the agent sends the plan card again with a fuller plan, markdown unless it needs something dynamic, writing no code.",
		seed: async (repo) => {
			await repo.write("src/upload.ts", uploadService);
		},
		message:
			"Earlier you proposed renaming the `id` local in upload() to `uploadId` and asked:\n\n1. Do you approve renaming the `id` local in upload() to `uploadId`?\n   - (a) Yes, approve it\n   - (b) No\n   - (c) Request a full plan\n\n1. c. Don't build it yet.",
		checks: [titled, planCard, notBuilt],
		limits: { turns: 40, minutes: 20 },
	},
	{
		id: `${aspect}/variant-choice-images`,
		aspect,
		initialized: true,
		requirement:
			"A questions card whose choices are mockup variants carries one attached image under each choice, not words alone.",
		seed: async (repo) => {
			await repo.write("settings.html", settingsPage);
		},
		message:
			"Mock up three different layouts for the settings screen's theme picker (a dropdown, radio buttons, a toggle) and ask me which to build. Don't build it.",
		checks: [
			{
				id: "image-under-each-choice",
				about:
					"at least two choices each have their own distinct attached image indented under them",
				test: ({ reply }) => {
					const paths: string[] = [];
					const lines = reply.replace(/```[\s\S]*?```/g, "").split("\n");
					for (let i = 0; i < lines.length; i++) {
						if (!/^\s*- [([][a-z][)\]]/.test(lines[i] ?? "")) {
							continue;
						}
						const next = lines[i + 1] ?? "";
						if (/^\s{2,}/.test(next)) {
							const found = deliveredImages(next);
							if (found[0]) {
								paths.push(found[0]);
							}
						}
					}
					return paths.length >= 2 && new Set(paths).size === paths.length;
				},
			},
			attached,
			{
				id: "kept-clean",
				about: "left the repo's files unchanged",
				test: async ({ repo }) =>
					(await repo.run(["git", "status", "--porcelain"])).trim() === "",
			},
			notBuilt,
		],
		limits: { turns: 40, minutes: 20 },
	},
	{
		id: `${aspect}/one-card-with-side-question`,
		aspect,
		initialized: true,
		requirement:
			"A plan that tempts a side question (a limit the user has not named) holds one questions card: the approval question last, the side question beside it with a pick, and no second card.",
		seed: async (repo) => {
			await repo.write("src/upload.ts", uploadService);
		},
		message:
			"What do you think about rejecting uploads over a size limit, and retrying the queue send with backoff when it fails? I have not picked the limit. Plan it, don't build it.",
		checks: [
			titled,
			{
				id: "side-question-beside",
				about:
					"the same card carries a second question with a chosen pick, and the reply has no other card",
				test: ({ reply }) => {
					const cards = stretches(reply);
					const asked = cards.filter((each) => each.type === "questions");
					// A plan card heads its questions, so it is no second card.
					const other = cards.filter(
						(each) =>
							each.type !== "text" &&
							each.type !== "questions" &&
							each.type !== "plan",
					);
					const first = asked[0];
					return (
						other.length === 0 &&
						first?.type === "questions" &&
						first.questions.length >= 2
					);
				},
			},
			notBuilt,
		],
		limits: { turns: 20, minutes: 10 },
		followUp: { turns: 3, done: proposed },
	},
	{
		id: `${aspect}/small-change-no-picture`,
		aspect,
		initialized: true,
		requirement:
			"A small change needs no picture: the plan stays text and attaches nothing.",
		seed: async (repo) => {
			await repo.write("src/upload.ts", uploadService);
		},
		message:
			"What do you think about renaming the `id` local in upload() to `uploadId`? Propose it, don't do it.",
		checks: [
			titled,
			{
				id: "no-image",
				about: "attached nothing and embedded no image",
				test: ({ commands, reply }) =>
					!commands.some((command) =>
						/\bsplates["']?\s+attach\b/.test(command),
					) && deliveredImages(reply).length === 0,
			},
			notBuilt,
		],
		limits: { turns: 20, minutes: 10 },
		followUp: { turns: 3, done: proposed },
	},
];

export const sandbox = splatesSandbox(scenarios);
