import { expect, test } from "bun:test";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { render } from "./testing";

function list(orientation?: "horizontal" | "vertical"): HTMLElement {
	return render(
		<Tabs value="a" orientation={orientation}>
			<TabsList aria-label={orientation ?? "default"}>
				<TabsTrigger value="a">A</TabsTrigger>
			</TabsList>
		</Tabs>,
	).getByRole("tablist", { name: orientation ?? "default" });
}

test("a vertical tab list and its tabs carry their own orientation, which their styles read", () => {
	const vertical = list("vertical");
	expect(vertical.getAttribute("data-orientation")).toBe("vertical");
	expect(
		vertical.querySelector("[role=tab]")?.getAttribute("data-orientation"),
	).toBe("vertical");
});

test("tabs nested in a vertical group stay horizontal by default", () => {
	const nested = render(
		<Tabs value="a" orientation="vertical">
			<Tabs value="b">
				<TabsList aria-label="nested">
					<TabsTrigger value="b">B</TabsTrigger>
				</TabsList>
			</Tabs>
		</Tabs>,
	).getByRole("tablist", { name: "nested" });
	expect(nested.getAttribute("data-orientation")).toBe("horizontal");
});
