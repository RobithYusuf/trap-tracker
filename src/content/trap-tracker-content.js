// Simplified content script

// Inject TrapTracker capture script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/injected/trap-tracker-capture.js');
script.onload = () => {
  script.remove();
};
script.onerror = (e) => {
  console.error('[TrapTracker] Failed to inject capture script:', e);
};
(document.head || document.documentElement).appendChild(script);

// Listen for errors from page
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data.source !== 'trap-tracker') return;
  if (event.data.type !== 'error-capture') return;
  
  // Content received error
  
  // Send to background
  chrome.runtime.sendMessage({
    type: 'error_captured',
    error: event.data.data
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[TrapTracker] Failed to send to background:', chrome.runtime.lastError);
    } else {
      // Error sent to background
    }
  });
});

// Listen for commands from extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'verify_capture_active') {
    // Send a test message to verify capture is working
    window.postMessage({
      source: 'trap-tracker',
      type: 'capture-test'
    }, '*');
    sendResponse({ status: 'test_sent' });
  }
});