import { afterEach, describe, expect, it } from "bun:test";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardList,
} from "#web/components/ui/card.tsx";
import { cleanup, render } from "./testing-library";

afterEach(cleanup);

describe("Card", () => {
	it("applies the canonical elevated card surface and merges custom classes", () => {
		const view = render(
			<Card data-testid="card" className="gap-2">
				Body
			</Card>,
		);
		const card = view.getByTestId("card");
		expect(card.tagName).toBe("DIV");
		expect(card.getAttribute("data-slot")).toBe("card");
		expect(card.className).toContain("overflow-hidden");
		expect(card.className).toContain("rounded-xl");
		expect(card.className).toContain("border");
		expect(card.className).toContain("bg-card");
		expect(card.className).toContain("text-card-foreground");
		expect(card.className).toContain("shadow-xs");
		expect(card.className).toContain("gap-2");
	});

	it("renders semantic elements through the render prop", () => {
		const view = render(
			<ul>
				<Card render={<li />} aria-label="requested API_KEY">
					Key form
				</Card>
			</ul>,
		);
		const item = view.getByRole("listitem", { name: "requested API_KEY" });
		expect(item.getAttribute("data-slot")).toBe("card");
		expect(item.className).toContain("rounded-xl");
		expect(item.className).toContain("shadow-xs");
	});

	it("supports padded CardContent, divided CardList, CardHeader variants, and CardFooter", () => {
		const view = render(
			<Card render={<article />} aria-label="rigs of mono">
				<CardHeader variant="muted">mono</CardHeader>
				<CardList>
					<li>web</li>
					<li>api</li>
				</CardList>
				<CardContent>Details</CardContent>
				<CardFooter>Footer action</CardFooter>
			</Card>,
		);
		const article = view.getByRole("article", { name: "rigs of mono" });
		const header = article.querySelector('[data-slot="card-header"]');
		const list = article.querySelector('[data-slot="card-list"]');
		const content = article.querySelector('[data-slot="card-content"]');
		const footer = article.querySelector('[data-slot="card-footer"]');

		expect(header?.className).toContain("border-b");
		expect(header?.className).toContain("bg-muted/50");
		expect(header?.getAttribute("data-variant")).toBe("muted");
		expect(list?.tagName).toBe("UL");
		expect(list?.className).toContain("divide-y");
		expect(content?.className).toContain("px-4");
		expect(content?.className).toContain("py-3");
		expect(footer?.className).toContain("border-t");
	});

	it("supports ordered lists and warning headers", () => {
		const view = render(
			<Card>
				<CardHeader variant="warning">Pending cred</CardHeader>
				<CardList render={<ol />}>
					<li>First</li>
					<li>Second</li>
				</CardList>
			</Card>,
		);
		const header = view.container.querySelector('[data-slot="card-header"]');
		const list = view.container.querySelector('[data-slot="card-list"]');

		expect(header?.className).toContain("bg-warning/[0.08]");
		expect(list?.tagName).toBe("OL");
		expect(list?.className).toContain("divide-y");
	});
});
