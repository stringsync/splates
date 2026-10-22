import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Splash } from "./splash";

afterEach(cleanup);

describe("Splash", () => {
	it("covers the page while shown", () => {
		const page = render(<Splash wanted />);

		const splash = page.getByText("🍽️");
		expect(splash.className).toContain("fixed inset-0");
		expect(splash.className).not.toContain("opacity-0");
	});

	it("fades once no longer wanted, and leaves when the fade ends", async () => {
		const page = render(<Splash wanted />);

		page.rerender(<Splash wanted={false} />);
		const splash = page.getByText("🍽️");
		await waitFor(() => expect(splash.className).toContain("opacity-0"));
		fireEvent.transitionEnd(splash);

		expect(page.queryByText("🍽️")).toBeNull();
	});

	it("covers the page again at once when shown again", () => {
		const page = render(<Splash wanted={false} />);
		expect(page.queryByText("🍽️")).toBeNull();

		page.rerender(<Splash wanted />);

		expect(page.getByText("🍽️").className).not.toContain("opacity-0");
	});

	it("does not start fading when wanted again within a moment", async () => {
		const page = render(<Splash wanted />);

		page.rerender(<Splash wanted={false} />);
		page.rerender(<Splash wanted />);
		await new Promise((resolve) => setTimeout(resolve, 200));

		expect(page.getByText("🍽️").className).not.toContain("opacity-0");
	});
});
