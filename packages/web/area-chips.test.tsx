import { expect, test } from "bun:test";
import { AreaChips } from "./area-chips";
import { render } from "./testing-library";

test("shows three areas and counts the rest", () => {
	const { container } = render(
		<AreaChips areas={["a", "b", "c", "d", "e"]} divided />,
	);
	expect(container.textContent).toBe("abc+2");
});

test("shows nothing without areas", () => {
	expect(render(<AreaChips areas={[]} />).container.textContent).toBe("");
	expect(render(<AreaChips areas={undefined} />).container.textContent).toBe(
		"",
	);
});
