// rec's /__rec/open page: a pointer press is the user gesture that lets the worker open the side panel.
addEventListener(
	"pointerdown",
	() =>
		chrome.runtime.sendMessage({
			type: "open",
			port: location.port,
			staged: location.search.includes("staged"),
			nomic: location.search.includes("nomic"),
		}),
	{ once: true, capture: true },
);
