import type {
	Decider,
	Finding,
	Rule,
	SourceFile,
	SyntaxNode,
	Tools,
} from "@webappwiz/scry";

const FUNCTIONS = [
	"function_declaration",
	"arrow_function",
	"function_expression",
];

const IN_STEP =
	"Do several of this component's useState values have to agree with each other, so the component keeps them in step by hand, in an effect or by setting them together?";

/**
 * Finds a component holding several pieces of `useState` that have to
 * agree: logic that belongs in a class the component reads through
 * `useReactive`. One `useState` is a self contained value, and fine.
 */
export default class ReactiveOverUseState implements Rule {
	static readonly description =
		"Logic with several moving parts lives in a class a component reads through useReactive, not in useState.";
	static readonly files = "**/*.{ts,tsx}";
	static readonly level = "warning";

	private som: Decider;

	constructor(tools: Tools) {
		this.som = tools.som;
	}

	async check(file: SourceFile): Promise<Finding[]> {
		return Promise.all(
			this.componentsWithSeveralStates(file).map((component) =>
				this.stateKeptInStep(component),
			),
		);
	}

	/** Functions that call `useState` twice or more themselves, not in a function inside. */
	private componentsWithSeveralStates(file: SourceFile): SyntaxNode[] {
		return file.ts
			.findAll({ rule: { any: FUNCTIONS.map((kind) => ({ kind })) } })
			.filter((component) => ownStates(component).length >= 2);
	}

	/** Whether those pieces of state have to agree is the som's call. */
	private async stateKeptInStep(component: SyntaxNode): Promise<Finding> {
		return component.flag(
			`${name(component)} keeps ${ownStates(component).length} pieces of useState in step: move the logic into a class with a Dispatcher, and read it through useReactive.`,
			await this.som.decide(IN_STEP, component),
			IN_STEP,
		);
	}
}

/** The `useState` calls a function makes itself. */
function ownStates(component: SyntaxNode): SyntaxNode[] {
	return component
		.findAll({
			rule: {
				kind: "call_expression",
				has: { field: "function", regex: "^(React\\.)?useState$" },
			},
		})
		.filter((call) => {
			const owner = call.ancestors().find((node) => node.is(...FUNCTIONS));
			return owner?.line === component.line && owner.text === component.text;
		});
}

/** A component's name, or what to call it when it has none. */
function name(component: SyntaxNode): string {
	return (
		component.field("name")?.text ??
		component.parent()?.field("name")?.text ??
		"This component"
	);
}
