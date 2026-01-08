chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'nytcs-fetch-html' && typeof message.url === 'string') {
    fetch(message.url, { credentials: 'omit', cache: 'no-store' })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        return response.text();
      })
      .then((text) => sendResponse({ ok: true, text }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  return false;
});

