import type { SystemsFile } from "splates/systems";

export default {
	models: {
		description: "Choosing agents and models",
		globs: [
			"packages/splates/models.ts",
			"packages/splates/roster.ts",
			"packages/splates/dev/setting-controls.tsx",
		],
	},
	conversations: {
		description: "The agent conversations on the splates server page",
		aliases: ["conversation view"],
		globs: [
			"packages/splates/conversations*.ts",
			"packages/splates/dev/conversation*.ts*",
			"packages/splates/dev/work*.ts*",
			"packages/splates/dev/app-conversation*.test.tsx",
		],
	},
	composer: {
		description: "Writing a message, with its # and @ references",
		aliases: ["mentions"],
		globs: [
			"packages/splates/dev/composing.tsx",
			"packages/splates/dev/mentions.tsx",
			"packages/splates/dev/references.tsx",
			"packages/splates/dev/directives.tsx",
			"packages/splates/dev/app-mentions.test.tsx",
		],
	},
	checkpoint: {
		description: "Restarting splates server without losing agents' work",
		aliases: ["restart"],
		globs: [
			"packages/splates/dev/checkpoint.tsx",
			"packages/splates/dev/auto-restart*.ts*",
		],
	},
	board: {
		description: "Todos and the lanes they sit in",
		aliases: ["todos", "lanes"],
		globs: [
			"packages/splates/todo*.ts",
			"packages/splates/lane*.ts",
			"packages/splates/dev/todo*.ts*",
			"packages/splates/dev/lanes.tsx",
			"packages/splates/dev/board.ts",
			"packages/splates/dev/app-todo*.test.tsx",
			"packages/splates/dev/app-lanes.test.tsx",
		],
	},
	mobile: {
		description: "splates server's phone layout",
		aliases: ["phone"],
		globs: [
			"packages/splates/dev/phone-*.tsx",
			"packages/splates/dev/app-phone.test.tsx",
		],
	},
	annotation: {
		description: "Marking up a screenshot for an agent",
		globs: [
			"packages/splates/dev/annotation.ts",
			"packages/splates/dev/annotation.test.ts",
			"packages/splates/dev/annotate.tsx",
		],
	},
	dictate: {
		description: "Speaking a message instead of typing it",
		aliases: ["dictation"],
		globs: [
			"packages/splates/dev-dictation*.ts",
			"packages/splates/dev-transcriber.ts",
			"packages/splates/vocabulary*.ts",
			"packages/splates/dev/dictat*.ts*",
			"packages/splates/dev/take-under-way.ts",
			"packages/splates/dev/app-conversation-dictation.test.tsx",
		],
	},
	merge: {
		description: "Landing a task on trunk",
		globs: ["packages/splates/merge.ts", "packages/splates/merge.test.ts"],
	},
	skills: {
		description: "The skills agents read",
		globs: ["skills/**"],
	},
} satisfies SystemsFile;
