/**
 * The editors a file the page names opens in: the link the browser hands it,
 * and the command `dev` runs on this machine to open the file inside the
 * tree it belongs to, which a link cannot say.
 */
export interface Editor {
	id: string;
	/** What the Settings dialog calls it. */
	label: string;
	/** The scheme of its `<scheme>://file/<path>:<line>` links. */
	scheme: string;
	/**
	 * The command that opens `tree` as its window and `file` in it, at `line`
	 * when there is one; the window alone when `file` is the tree.
	 */
	argv(tree: string, file: string, line: number | null): string[];
}

export const ZED: Editor = {
	id: "zed",
	label: "Zed",
	scheme: "zed",
	argv: (tree, file, line) =>
		file === tree ? ["zed", tree] : ["zed", tree, at(file, line)],
};

/** Every editor, in the order the Settings dialog offers them. */
export const EDITORS = [
	ZED,
	codeFamily("vscode", "VS Code", "code"),
	codeFamily("cursor", "Cursor", "cursor"),
] as const satisfies readonly Editor[];

/** The editor `id` names, or null for one this arbor does not know. */
export function editorOf(id: string): Editor | null {
	return EDITORS.find((editor) => editor.id === id) ?? null;
}

const at = (file: string, line: number | null) =>
	line === null ? file : `${file}:${line}`;

/** One of VS Code's family, whose command takes the file to go to after `-g`. */
function codeFamily(id: string, label: string, command: string): Editor {
	return {
		id,
		label,
		scheme: id,
		argv: (tree, file, line) =>
			file === tree ? [command, tree] : [command, tree, "-g", at(file, line)],
	};
}
