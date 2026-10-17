import type {
	Decider,
	Finding,
	Rule,
	SourceFile,
	SyntaxNode,
	Tools,
} from "@webappwiz/scry";

/**
 * Finds logic a framework holds: a component, hook, route or fetch handler,
 * or CLI action that decides or computes rather than translating to a plain object,
 * and a plain class that uses a framework's names, so it cannot run without it.
 */
export default class LogicLivesInControllers implements Rule {
	static readonly description =
		"Logic, meaningful state and decisions live in a controller, a plain class; a component, route or CLI action only translates.";
	static readonly files = "**/*.{ts,tsx}";
	static readonly level = "warning";
	static readonly recommended = true;

	private som: Decider;

	constructor(tools: Tools) {
		this.som = tools.som;
	}

	async check(file: SourceFile): Promise<Finding[]> {
		if (TESTING.test(file.path)) {
			return [];
		}
		const imported = frameworkImports(file);
		return [
			...this.plainClassesThatNeedAFramework(file, imported),
			...(await this.adaptersThatDoMoreThanTranslate(file, imported)),
		].toSorted((left, right) => left.line - right.line);
	}

	/**
	 * A plain class that uses a name a framework exports, like a service
	 * taking koa's `Context` or throwing Hono's `HTTPException`. Code decides
	 * it: such a class cannot run without the framework. A class that renders
	 * JSX, extends a framework's class or registers routes or actions is an
	 * adapter, not a plain class.
	 */
	private plainClassesThatNeedAFramework(
		file: SourceFile,
		imported: Map<string, string>,
	): Finding[] {
		return file.ts
			.topLevel()
			.filter((node) => node.is("class_declaration"))
			.filter(
				(node) =>
					!hasJsx(node) &&
					!node
						.children()
						.some(
							(child) =>
								child.is("class_heritage") &&
								namesIn(child).some((each) => imported.has(each)),
						) &&
					routeHandlers(node).length === 0 &&
					actions(node).length === 0,
			)
			.flatMap((node) => {
				const used = [
					...new Set(namesIn(node).filter((each) => imported.has(each))),
				];
				const [first] = used;
				if (first === undefined) {
					return [];
				}
				const module = imported.get(first) ?? first;
				return [
					node.flag(
						`${node.field("name")?.text ?? "This class"} uses ${used.join(", ")} from ${module}, so it cannot run without it: give it plain arguments and results, and leave ${module} to the adapter that calls it.`,
					),
				];
			});
	}

	/**
	 * Components, hooks, route handlers and CLI actions that may decide or
	 * compute, which the som weighs one at a time. Code passes the rest:
	 * a component or hook holding no state whose handlers never branch, and a
	 * handler or action that neither branches nor runs a function of its own,
	 * only translates.
	 */
	private async adaptersThatDoMoreThanTranslate(
		file: SourceFile,
		imported: Map<string, string>,
	): Promise<Finding[]> {
		const kinds = new Set(
			[...imported.values()].map((module) => frameworkOf(module)),
		);
		const adapters = [
			...components(file),
			...(kinds.has("server")
				? routeHandlers(file.ts.root)
				: fetchHandlers(file, imported)),
			...(kinds.has("cli") ? actions(file.ts.root) : []),
		].filter((adapter) => adapter.mayDecide);
		return Promise.all(
			adapters.map(async (adapter) =>
				adapter.at.flag(
					adapter.message,
					await this.som.decide(DECIDES, adapter.body),
					DECIDES,
				),
			),
		);
	}
}

/**
 * The names a file imports from a framework, each to the module it came
 * from: `Context` to `koa` for `import type { Context } from "koa"`.
 */
function frameworkImports(file: SourceFile): Map<string, string> {
	const imported = new Map<string, string>();
	for (const statement of file.ts.findAll({
		rule: { kind: "import_statement" },
	})) {
		const module = statement.field("source")?.text.slice(1, -1) ?? "";
		const clause = statement
			.children()
			.find((child) => child.is("import_clause"));
		if (frameworkOf(module) !== undefined && clause !== undefined) {
			for (const name of namesIn(clause)) {
				imported.set(name, module);
			}
		}
	}
	return imported;
}

/** What a module adapts to, when it is a framework's or one of its subpaths. */
function frameworkOf(module: string): "ui" | "server" | "cli" | undefined {
	const name = Object.keys(FRAMEWORKS).find(
		(each) => module === each || module.startsWith(`${each}/`),
	);
	return name === undefined ? undefined : FRAMEWORKS[name];
}

/**
 * The React components and hooks at the top of a file: functions named in
 * PascalCase that return JSX, and functions named `use` and a capital.
 */
function components(file: SourceFile): Adapter[] {
	return file.ts.topLevel().flatMap((node) => {
		const named: [string, SyntaxNode][] = node.is("function_declaration")
			? [[node.field("name")?.text ?? "", node]]
			: node.is("lexical_declaration")
				? node.children().flatMap((declarator) => {
						const value = declarator.field("value");
						return value?.is(...FUNCTIONS)
							? [[declarator.field("name")?.text ?? "", value]]
							: [];
					})
				: [];
		return named.flatMap(([name, body]): Adapter[] => {
			const hook = /^use[A-Z]/.test(name);
			if (!hook && !(/^[A-Z]/.test(name) && hasJsx(body))) {
				return [];
			}
			return [
				{
					body,
					at: node,
					mayDecide:
						holdsState(body) ||
						inner(body).some((handler) => branches(handler)),
					message: `${name} keeps state or makes decisions itself: move them into a plain class with a method per control, and let the ${hook ? "hook" : "component"} read it through useReactive and call it.`,
				},
			];
		});
	});
}

/** The handlers registered with a path under `node`, as `app.get("/todos", handler)`. */
function routeHandlers(node: SyntaxNode): Adapter[] {
	return node
		.findAll({
			rule: {
				kind: "call_expression",
				has: {
					field: "function",
					kind: "member_expression",
					has: { field: "property", regex: `^(${ROUTES.join("|")})$` },
				},
			},
		})
		.flatMap((call) => {
			const [path, ...rest] = call.field("arguments")?.children() ?? [];
			const handler = rest.findLast((argument) => argument.is(...FUNCTIONS));
			if (!path?.is("string", "template_string") || handler === undefined) {
				return [];
			}
			const method = call.field("function")?.field("property");
			return [
				{
					body: handler,
					at: method ?? call,
					mayDecide: computes(handler),
					message: `${method?.text.toUpperCase() ?? "A route"} ${path.text.slice(1, -1)} decides or computes in its handler: move that into a plain service with a method per route, and let the handler translate the request into one call and its result into the response.`,
				},
			];
		});
}

/**
 * The functions a web server without a framework calls: each whose first
 * parameter is the web's own `Request`, as `Bun.serve`, a Worker or a
 * Next.js route hands them. A `Request` a file imports is some framework's,
 * whose handlers `routeHandlers` reads.
 */
function fetchHandlers(
	file: SourceFile,
	imported: Map<string, string>,
): Adapter[] {
	if (imported.has("Request")) {
		return [];
	}
	return file.ts
		.findAll({ rule: { any: FUNCTIONS.map((kind) => ({ kind })) } })
		.filter(
			(handler) =>
				handler
					.field("parameters")
					?.children()
					.find((parameter) => parameter.is("required_parameter"))
					?.field("type")
					?.text.replace(/^:\s*/, "") === "Request",
		)
		.map((handler) => {
			const name =
				handler.field("name")?.text ??
				(handler.parent()?.is("variable_declarator")
					? handler.parent()?.field("name")?.text
					: undefined);
			return {
				body: handler,
				at: handler,
				mayDecide: computes(handler),
				message: `${name ?? "This handler"} decides or computes itself: move that into a plain service with a method per route, and let the handler translate the request into one call and its result into the response.`,
			};
		});
}

/** The functions handed to a CLI command's `.action(...)` under `node`. */
function actions(node: SyntaxNode): Adapter[] {
	return node
		.findAll({
			rule: {
				kind: "call_expression",
				has: {
					field: "function",
					kind: "member_expression",
					has: { field: "property", regex: "^action$" },
				},
			},
		})
		.flatMap((call) => {
			const action = call
				.field("arguments")
				?.children()
				.find((argument) => argument.is(...FUNCTIONS));
			if (action === undefined) {
				return [];
			}
			const command = /\.command\(\s*["'`]([^"'`]+)/.exec(call.text)?.[1];
			return [
				{
					body: action,
					// a chain's call starts where the chain does, lines above
					at: call.field("function")?.field("property") ?? call,
					mayDecide: computes(action),
					message: `${command === undefined ? "This command" : `The ${command} command`}'s action decides or computes itself: move that into a plain program the action calls, so it runs without the CLI.`,
				},
			];
		});
}

/** Whether a function calls `useState` or `useReducer`. */
function holdsState(body: SyntaxNode): boolean {
	return (
		body.findAll({
			rule: {
				kind: "call_expression",
				has: {
					field: "function",
					regex: "^(React\\.)?(useState|useReducer)$",
				},
			},
		}).length > 0
	);
}

/** Whether a handler branches, or runs a function of its own like a `.filter` callback. */
function computes(body: SyntaxNode): boolean {
	return branches(body) || inner(body).length > 0;
}

function branches(body: SyntaxNode): boolean {
	return (
		body.findAll({ rule: { any: BRANCHES.map((kind) => ({ kind })) } }).length >
		0
	);
}

/** The functions declared inside a function. */
function inner(body: SyntaxNode): SyntaxNode[] {
	return body
		.findAll({ rule: { any: FUNCTIONS.map((kind) => ({ kind })) } })
		.filter((node) => node.line !== body.line || node.text !== body.text);
}

/** Whether a node renders JSX, which only a `.tsx` file can. */
function hasJsx(node: SyntaxNode): boolean {
	return (
		node.file.path.endsWith(".tsx") &&
		node.findAll({
			rule: {
				any: [{ kind: "jsx_element" }, { kind: "jsx_self_closing_element" }],
			},
		}).length > 0
	);
}

/** The identifiers and type names a node mentions. */
function namesIn(node: SyntaxNode): string[] {
	return node
		.findAll({
			rule: { any: [{ kind: "identifier" }, { kind: "type_identifier" }] },
		})
		.map((name) => name.text);
}

/**
 * The frameworks an adapter is written for, by the module each is imported
 * from, and what it adapts to: a UI, a web server or a CLI. A module's
 * subpaths count as it, so `hono/factory` is Hono.
 */
const FRAMEWORKS: Record<string, "ui" | "server" | "cli"> = {
	react: "ui",
	"react-dom": "ui",
	preact: "ui",
	koa: "server",
	"@koa/router": "server",
	hono: "server",
	express: "server",
	fastify: "server",
	"webappwiz/cmd": "cli",
	commander: "cli",
};

/** The methods a web server routes a request through, as `app.get(path, handler)`. */
const ROUTES = ["get", "post", "put", "patch", "delete", "all", "head"];

const FUNCTIONS = [
	"function_declaration",
	"arrow_function",
	"function_expression",
];

/** What makes code choose, rather than pass along what it was given. */
const BRANCHES = [
	"if_statement",
	"switch_statement",
	"ternary_expression",
	"for_statement",
	"for_in_statement",
	"while_statement",
	"do_statement",
	"try_statement",
];

/** Tests and their fakes stand in for a framework on purpose. */
const TESTING = /(\.test\.tsx?|(^|\/)testing\.tsx?)$/;

const DECIDES =
	"Does this adapter decide or compute things itself that a plain class or program should, such as keeping meaningful state (a draft, whether it is busy), making decisions (whether something changed or is allowed, which items to act on, what happens next), or running a query and computing from its result? Translating input into one call per control, route or command on a plain object, results into output, purely visual state like whether a menu is open, and keeping up with the framework's own lifecycle, such as mounts and renders, are not.";

/** A function a framework calls: a component, a hook, a route handler or a CLI action. */
interface Adapter {
	/** The function, which the som reads. */
	body: SyntaxNode;
	/**
	 * Where its finding points: the function, or the method name that
	 * registers it, like `.action`, which in a chain is on its own line.
	 */
	at: SyntaxNode;
	/** Whether code cannot tell it only translates, so the som is asked. */
	mayDecide: boolean;
	/** What to do instead, when it decides. */
	message: string;
}
