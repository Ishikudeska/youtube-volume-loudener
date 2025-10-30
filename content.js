// content.js — injects a GainNode for video elements and listens for popup messages
(function () {
  const DEFAULT_GAIN = 2.0;
  const DEFAULT_ENABLED = true;

  // Global settings (kept in-memory per page). Persisted in chrome.storage.sync by popup.
  let settings = { gain: DEFAULT_GAIN, enabled: DEFAULT_ENABLED };

  // Read stored settings if available
  try {
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['gain', 'enabled'], (items) => {
        if (items.gain !== undefined) settings.gain = Number(items.gain);
        if (items.enabled !== undefined) settings.enabled = Boolean(items.enabled);
        // After loading settings, scan for videos so attachments use those values
        scanForVideos();
      });
    }
  } catch (e) {
    // If storage isn't available, just proceed with defaults
    console.warn('Loudener: storage access failed', e);
  }

  function safeDisconnect(node) {
    try {
      if (node && typeof node.disconnect === 'function') node.disconnect();
    } catch (e) {
      // ignore
    }
  }

  function attachLoudener(video) {
    if (!video || video._loudenerAttached) return;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      console.warn('Loudener: no AudioContext available');
      return;
    }

    let audioCtx;
    try {
      audioCtx = new AudioCtx();
    } catch (e) {
      console.warn('Loudener: could not create AudioContext', e);
      return;
    }

    // Attempt to resume on first user gesture if needed
    const resumeOnGesture = () => {
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    };
    document.addEventListener('click', resumeOnGesture, { once: true });

    let source, gainNode;
    try {
      source = audioCtx.createMediaElementSource(video);
      gainNode = audioCtx.createGain();
      gainNode.gain.value = settings.gain;
    } catch (err) {
      console.warn('Loudener: could not create media source or gain node', err);
      return;
    }

    function applyConnections() {
      // Disconnect any previous connections safely
      try {
        source.disconnect();
      } catch (e) {}
      try {
        gainNode.disconnect();
      } catch (e) {}

      if (settings.enabled) {
        // source -> gain -> destination
        try {
          source.connect(gainNode);
          gainNode.connect(audioCtx.destination);
        } catch (e) {
          console.warn('Loudener: failed to connect nodes', e);
        }
      } else {
        // direct output: source -> destination
        try {
          source.connect(audioCtx.destination);
        } catch (e) {
          console.warn('Loudener: failed to connect source directly', e);
        }
      }
    }

    applyConnections();

    video._loudenerAttached = true;
    video._loudener = {
      audioCtx,
      source,
      gainNode,
      applyConnections,
      setGain: (g) => {
        gainNode.gain.value = g;
      },
      setEnabled: (v) => {
        settings.enabled = !!v;
        applyConnections();
      }
    };

    console.debug('Loudener: attached to video', video, 'settings:', settings);
  }

  function scanForVideos() {
    const videos = Array.from(document.querySelectorAll('video'));
    videos.forEach((v) => {
      if (v._loudenerAttached) return;
      if (v.readyState > 0 || v.currentSrc) {
        attachLoudener(v);
      } else {
        v.addEventListener('loadedmetadata', function onMeta() {
          v.removeEventListener('loadedmetadata', onMeta);
          attachLoudener(v);
        });
      }
    });
  }

  // MutationObserver to catch dynamic video insertions (YouTube uses dynamic loading)
  const mo = new MutationObserver(() => scanForVideos());
  mo.observe(document, { childList: true, subtree: true });

  // If storage changes from popup, update local settings and apply to attached videos
  try {
    if (chrome && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (changes.gain) settings.gain = Number(changes.gain.newValue);
        if (changes.enabled) settings.enabled = Boolean(changes.enabled.newValue);
        // apply to all attached videos
        document.querySelectorAll('video').forEach((v) => {
          if (v._loudener && v._loudener.setGain) v._loudener.setGain(settings.gain);
          if (v._loudener && v._loudener.setEnabled) v._loudener.setEnabled(settings.enabled);
        });
      });
    }
  } catch (e) {
    // ignore
  }

  // Listen for direct messages from popup
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'setGain') {
        settings.gain = Number(msg.gain);
        // apply gain to all attached videos
        document.querySelectorAll('video').forEach((v) => {
          if (v._loudener && v._loudener.setGain) v._loudener.setGain(settings.gain);
        });
        sendResponse({ ok: true });
      } else if (msg.type === 'setEnabled') {
        settings.enabled = !!msg.enabled;
        document.querySelectorAll('video').forEach((v) => {
          if (v._loudener && v._loudener.setEnabled) v._loudener.setEnabled(settings.enabled);
        });
        sendResponse({ ok: true });
      } else if (msg.type === 'getState') {
        sendResponse({ gain: settings.gain, enabled: settings.enabled });
      }
      // keep message channel open for asynchronous response if needed
      return true;
    });
  } catch (e) {
    console.warn('Loudener: messaging not available', e);
  }

  // Initial scan (if storage retrieval above didn't call it)
  if (!document.__loudener_scanned) {
    document.__loudener_scanned = true;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scanForVideos);
    } else {
      scanForVideos();
    }
  }
})();
