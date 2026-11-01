import { expect, test } from "bun:test";
import { TagChips, TagColorsContext } from "./tag-chips";
import { render } from "./testing-library";

test("tag chips list the tags in order, none for none", () => {
	const some = render(<TagChips tags={["web", "api"]} />);
	expect(some.container.textContent).toBe("apiweb");
	some.unmount();
	const none = render(<TagChips tags={[]} />);
	expect(none.container.textContent).toBe("");
});

test("a tag with a configured color gets its chip, another stays plain", () => {
	const colored = render(
		<TagColorsContext.Provider value={{ web: "indigo" }}>
			<TagChips tags={["web", "api"]} />
		</TagColorsContext.Provider>,
	);
	expect(colored.getByTitle("Tag web").className).toContain("bg-indigo-100");
	expect(colored.getByTitle("Tag api").className).not.toContain("bg-");
});

test("a capped list counts the tags it leaves out", () => {
	const capped = render(<TagChips tags={["d", "c", "b", "a"]} max={2} />);
	expect(capped.container.textContent).toBe("ab+2");
});
