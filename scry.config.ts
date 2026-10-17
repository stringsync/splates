import type { ScryConfig } from "@webappwiz/scry/config";

const VENDORED_RULES = [
	"classes-over-function-exports",
	"comments-say-why-not-what",
	"doc-comments-address-users",
	"export-leads-the-file",
	"fakes-over-mocks",
	"logic-lives-in-controllers",
	"matchers-over-test-logic",
	"named-options-last",
	"no-em-dashes",
	"objects-over-callbacks",
	"one-class-per-file",
	"parameters-declare-fields",
	"reactive-over-use-state",
	"resources-are-disposable",
	"simple-test-setup",
	"test-setup-names-what-it-makes",
	"tests-own-their-state",
];

// the skills under .agents and the rules `splates dev scry add` copied from the
// catalog are vendored, not this repository's to fix; `splates dev scry update`
// refreshes them
export default {
	exclude: [".agents/**", ...VENDORED_RULES.map((id) => `.wiz/scry/${id}/**`)],
	budgets: {
		som: { tokens: 5_000_000, per: "day" },
		llm: "nothing",
	},
} satisfies ScryConfig;
