import { beforeEach, describe, expect, it } from "bun:test";
import { Cases, SourceFile } from "@webappwiz/scry";
import { FakeDecider } from "@webappwiz/scry/testing";
import ReactiveOverUseState from "./rule";

const cases = await Cases.load(import.meta.dir);

describe("reactive-over-use-state", () => {
	let som: FakeDecider;
	let rule: ReactiveOverUseState;

	beforeEach(() => {
		som = new FakeDecider({}, 0.8);
		rule = new ReactiveOverUseState({ som, llm: new FakeDecider() });
	});

	it.each(cases.bad)("asks about $name", async ({ file }) => {
		await rule.check(file);

		expect(som.asked).not.toEqual([]);
	});

	it.each(cases.good)("asks nothing about $name", async ({ file }) => {
		await rule.check(file);

		expect(som.asked).toEqual([]);
	});

	it("asks about the component holding several pieces of state, not a function inside it", async () => {
		const file = new SourceFile(
			"a.tsx",
			[
				"function Form() {",
				'\tconst [name, setName] = useState("");',
				'\tconst [email, setEmail] = useState("");',
				"\tconst Inner = () => {",
				"\t\tconst [open, setOpen] = useState(false);",
				"\t\treturn <p />;",
				"\t};",
				"\treturn <Inner />;",
				"}",
			].join("\n"),
		);

		const findings = await rule.check(file);

		expect([
			findings.map((finding) => [finding.line, finding.confidence]),
			findings.map((finding) => finding.message),
		]).toEqual([
			[[1, 0.8]],
			[
				"Form keeps 2 pieces of useState in step: move the logic into a class with a Dispatcher, and read it through useReactive.",
			],
		]);
	});
});
