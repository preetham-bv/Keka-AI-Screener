import Tesseract from 'tesseract.js';

let tesseractWorker = null;

async function getWorker() {
  if (!tesseractWorker) {
    tesseractWorker = await Tesseract.createWorker({
      workerPath: chrome.runtime.getURL('tesseract.worker.min.js'),
      logger: m => console.log('Tesseract OCR (Offscreen):', m.status, Math.round(m.progress * 100) + '%')
    });
    await tesseractWorker.loadLanguage('eng');
    await tesseractWorker.initialize('eng');
  }
  return tesseractWorker;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') {
    return false;
  }

  if (message.type === 'recognizeImage') {
    handleRecognizeImage(message.data)
      .then(text => sendResponse({ success: true, text }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for the async response
  }
});

async function handleRecognizeImage(dataUrl) {
  try {
    const worker = await getWorker();
    
    // Tesseract.js accepts data URL strings
    const { data: { text } } = await worker.recognize(dataUrl);
    return text;
  } catch (error) {
    console.error('Error during OCR in offscreen document:', error);
    throw error;
  }
}
