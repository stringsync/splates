import { afterEach, describe, expect, it } from "bun:test";
import { EvalTranscript, toolArgs } from "./eval-report-card";
import { cleanup, fireEvent, render } from "./testing-library";

afterEach(cleanup);

const path =
	"/private/var/folders/T/eval-rUOc3U/repo/.agents/skills/splates/SKILL.md";

describe("toolArgs", () => {
	it("reads a one-field JSON object as its string and opens it pretty-printed", () => {
		expect(toolArgs(JSON.stringify({ Path: path }))).toEqual({
			short: path,
			full: `{\n  "Path": "${path}"\n}`,
		});
	});

	it("keeps JSON of several fields as it came on the line", () => {
		const args = JSON.stringify({ Path: path, Limit: 80 });
		expect(toolArgs(args).short).toBe(args);
		expect(toolArgs(args).full).toContain('\n  "Limit": 80\n');
	});

	it("keeps plain arguments as they are", () => {
		expect(toolArgs("bun test --changed")).toEqual({
			short: "bun test --changed",
			full: "bun test --changed",
		});
	});
});

describe("EvalTranscript tool rows", () => {
	it("shows a tool call's arguments in a line and opens to them in full", () => {
		const view = render(
			<EvalTranscript
				seededCount={0}
				items={[
					{
						index: 0,
						line: {
							who: "tool",
							text: `read_file ${JSON.stringify({ Path: path })}`,
						},
					},
				]}
			/>,
		);
		const row = view.getByRole("button", { name: /read_file/ });
		expect(row.textContent).toContain(path);
		expect(row.textContent).not.toContain('"Path"');
		fireEvent.click(row);
		expect(view.getByText(/"Path": "/)).toBeTruthy();
	});
});
