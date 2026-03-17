console.log("[JobScout] Background service worker started");

chrome.runtime.onInstalled.addListener(() => {
  console.log("[JobScout] Extension installed");
});
