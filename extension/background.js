// Service worker: relay toggle messages to the active tab's content script.
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
});
