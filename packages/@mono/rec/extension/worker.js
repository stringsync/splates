// No await between the message and open(): awaiting spends the user gesture.
chrome.runtime.onMessage.addListener((message, sender) => {
	if (message.type !== "open" || !sender.tab) {
		return;
	}
	const staged =
		(message.staged ? "&staged=1" : "") + (message.nomic ? "&nomic=1" : "");
	chrome.sidePanel.setOptions({
		path: `panel.html?port=${message.port}${staged}`,
		enabled: true,
	});
	chrome.sidePanel.open({ windowId: sender.tab.windowId });
});
