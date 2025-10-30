// popup.js — controls the loudener (gain and enabled) via messages to the active tab
(function () {
  const gainRange = document.getElementById('gainRange');
  const gainVal = document.getElementById('gainVal');
  const enabledCheckbox = document.getElementById('enabled');

  function setUI(gain, enabled) {
    gainRange.value = gain;
    gainVal.textContent = Number(gain).toFixed(1) + '×';
    enabledCheckbox.checked = !!enabled;
  }

  function sendToActiveTab(message, cb) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, message, cb);
      });
    } catch (e) {
      console.warn('Popup: failed to send message', e);
    }
  }

  // Load initial state from the active tab (content script) or fallback to storage
  function loadState() {
    sendToActiveTab({ type: 'getState' }, (resp) => {
      if (chrome.runtime.lastError) {
        // content script may not be ready; fallback to storage
        try {
          chrome.storage.sync.get(['gain', 'enabled'], (items) => {
            const g = items.gain !== undefined ? Number(items.gain) : 2.0;
            const e = items.enabled !== undefined ? Boolean(items.enabled) : true;
            setUI(g, e);
          });
        } catch (e) {
          setUI(2.0, true);
        }
        return;
      }
      if (resp && resp.gain !== undefined) {
        setUI(resp.gain, resp.enabled);
      } else {
        setUI(2.0, true);
      }
    });
  }

  gainRange.addEventListener('input', () => {
    const val = Number(gainRange.value);
    gainVal.textContent = val.toFixed(1) + '×';
  });

  gainRange.addEventListener('change', () => {
    const val = Number(gainRange.value);
    // persist and notify
    try { chrome.storage.sync.set({ gain: val }); } catch (e) {}
    sendToActiveTab({ type: 'setGain', gain: val }, () => {});
  });

  enabledCheckbox.addEventListener('change', () => {
    const en = enabledCheckbox.checked;
    try { chrome.storage.sync.set({ enabled: en }); } catch (e) {}
    sendToActiveTab({ type: 'setEnabled', enabled: en }, () => {});
  });

  document.addEventListener('DOMContentLoaded', loadState);
})();
