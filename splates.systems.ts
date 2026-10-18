import type { SystemsFile } from "@stringsync/splates/systems";

export default {
	models: {
		description: "Choosing agents and models",
		globs: [
			"packages/splates/models.ts",
			"packages/splates/roster.ts",
			"packages/web/setting-controls.tsx",
		],
	},
	conversations: {
		description: "The agent conversations on the splates server page",
		aliases: ["conversation view", "sidebar"],
		globs: [
			"packages/splates/conversations*.ts",
			"packages/web/conversation*.ts*",
			"packages/web/sidebar*.tsx",
			"packages/web/work*.ts*",
			"packages/web/app-conversation*.test.tsx",
		],
	},
	composer: {
		description: "Writing a message, with its # and @ references",
		aliases: ["mentions"],
		globs: [
			"packages/web/composing.tsx",
			"packages/web/mentions.tsx",
			"packages/web/references.tsx",
			"packages/web/directives.tsx",
			"packages/web/app-mentions.test.tsx",
		],
	},
	setup: {
		description: "Setting splates up on a machine",
		globs: [
			"packages/splates/setup*.ts",
			"packages/splates/dev-setup*.ts",
			"packages/splates/splates-setup.ts",
			"packages/web/setup-*.ts*",
			"packages/web/app-setup.test.tsx",
			"packages/web/review/setup-forms*",
		],
	},
	checkpoint: {
		description: "Restarting splates server without losing agents' work",
		aliases: ["restart"],
		globs: ["packages/web/checkpoint.tsx", "packages/web/auto-restart*.ts*"],
	},
	board: {
		description: "Todos and the lanes they sit in",
		aliases: ["todos", "lanes"],
		globs: [
			"packages/splates/todo*.ts",
			"packages/splates/lane*.ts",
			"packages/web/todo*.ts*",
			"packages/web/lanes.tsx",
			"packages/web/board.ts",
			"packages/web/app-todo*.test.tsx",
			"packages/web/app-lanes.test.tsx",
		],
	},
	mobile: {
		description: "splates server's phone layout",
		aliases: ["phone"],
		globs: ["packages/web/phone-*.tsx", "packages/web/app-phone.test.tsx"],
	},
	annotation: {
		description: "Marking up a screenshot for an agent",
		globs: [
			"packages/web/annotation.ts",
			"packages/web/annotation.test.ts",
			"packages/web/annotate.tsx",
		],
	},
	dictate: {
		description: "Speaking a message instead of typing it",
		aliases: ["dictation"],
		globs: [
			"packages/splates/dev-dictation*.ts",
			"packages/splates/dev-transcriber.ts",
			"packages/splates/vocabulary*.ts",
			"packages/web/dictat*.ts*",
			"packages/web/take-under-way.ts",
			"packages/web/app-conversation-dictation.test.tsx",
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
	everywhere: {
		description: "Every project's work on one page",
		globs: [
			"packages/splates/dev-everywhere*.ts",
			"packages/splates/everywhere.ts",
			"packages/web/everywhere-*.ts",
		],
	},
} satisfies SystemsFile;
