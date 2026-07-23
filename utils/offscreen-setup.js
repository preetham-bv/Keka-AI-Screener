let creatingOffscreen;

export async function setupOffscreenDocument(path) {
  const offscreenUrl = chrome.runtime.getURL(path);
  
  // Check if an offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // create offscreen document
  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: path,
      reasons: ['WORKERS'], 
      justification: 'Run Tesseract OCR in a Worker environment'
    });
    await creatingOffscreen;
    creatingOffscreen = null;
  }
}
