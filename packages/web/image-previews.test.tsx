import { afterEach, describe, expect, it } from "bun:test";
import { useConversationImagePreviews } from "./image-previews";
import { act, cleanup, fireEvent, render } from "./testing-library";

function Toggle({ id }: { id: string }) {
	const { expanded, toggle } = useConversationImagePreviews(id);
	return (
		<button type="button" onClick={toggle} aria-pressed={expanded}>
			{expanded ? "Expanded" : "Collapsed"}
		</button>
	);
}

describe("useConversationImagePreviews", () => {
	afterEach(() => {
		cleanup();
		localStorage.clear();
	});

	it("persists expanded state per conversation in localStorage across mounts", () => {
		const first = render(<Toggle id="c1" />);
		expect(first.getByRole("button").textContent).toBe("Collapsed");

		act(() => fireEvent.click(first.getByRole("button")));
		expect(first.getByRole("button").textContent).toBe("Expanded");
		first.unmount();

		const remounted = render(<Toggle id="c1" />);
		expect(remounted.getByRole("button").textContent).toBe("Expanded");

		const other = render(<Toggle id="c2" />);
		expect(other.getAllByRole("button")[1]?.textContent).toBe("Collapsed");
	});
});
