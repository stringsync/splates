import type { ConfigFile } from "@stringsync/splates-server/config";

export default {
	// A fresh tree has no workspace links yet, so bootstrap before loading the CLI.
	postCheckout: "bun install",
	postRewrite: "bun install",
	preLock: "./bin/splates dev premerge --checks",
	preMerge: "./bin/splates dev premerge",
	remote: null,
	// Where `splates dev eval run` writes its batches, as the Evals page reads
	// them, and how the page's run card lists, plans and starts them.
	evals: {
		results: "~/.splates/evals",
		list: "./bin/splates dev eval list --json",
		plan: "./bin/splates dev eval plan --json",
		run: "./bin/splates dev eval run",
	},
	dictationWords: ["webappwiz", "scry", "premerge", "worktree", "Bun"],
} satisfies ConfigFile;
