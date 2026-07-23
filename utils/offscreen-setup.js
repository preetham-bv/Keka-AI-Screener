let setupMutex = Promise.resolve();
let creatingOffscreen;

export async function setupOffscreenDocument(path) {
  // Strict mutex lock to prevent concurrent workers from triggering race conditions in MV3
  const unlock = await new Promise(resolve => {
    let nextMutex;
    const previousMutex = setupMutex;
    setupMutex = previousMutex.then(() => {
      return new Promise(r => { nextMutex = r; });
    });
    // Wait for the previous lock to be released before resolving with our unlock function
    previousMutex.then(() => resolve(nextMutex));
  });

  try {
    const offscreenUrl = chrome.runtime.getURL(path);
    
    // Check if an offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });

    if (existingContexts.length === 0) {
      // create offscreen document
      if (creatingOffscreen) {
        await creatingOffscreen;
      } else {
        creatingOffscreen = chrome.offscreen.createDocument({
          url: path,
          reasons: ['WORKERS'], 
          justification: 'Run Tesseract OCR and PDF.js in a Worker environment'
        });
        await creatingOffscreen;
        creatingOffscreen = null;
      }
    }

    // Wait until the offscreen document is ready by pinging it
    let isReady = false;
    let attempts = 0;
    while (!isReady && attempts < 50) { // Try for up to 5 seconds
      try {
        const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ping' });
        if (response && response.success) {
          isReady = true;
        }
      } catch (e) {
        // "Receiving end does not exist" error will be caught here
      }
      if (!isReady) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
    }
    
    if (!isReady) {
      throw new Error('Failed to establish connection to offscreen document after 5 seconds.');
    }
  } finally {
    // Release the mutex
    unlock();
  }
}
