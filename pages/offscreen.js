import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import { dbManager } from '../services/instances.js';

// Use the local worker file packed by webpack to avoid "No GlobalWorkerOptions.workerSrc" error
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');
// Ensure dbManager is initialized
let dbInitialized = false;
async function ensureDb() {
  if (!dbInitialized) {
    await dbManager.init();
    dbInitialized = true;
  }
}

let schedulerPromise = null;

async function getScheduler() {
  if (!schedulerPromise) {
    schedulerPromise = (async () => {
      const sched = Tesseract.createScheduler();
      // Create a pool of 3 workers for concurrent OCR
      for (let i = 0; i < 3; i++) {
        const worker = await Tesseract.createWorker({
          workerPath: chrome.runtime.getURL('tesseract.worker.min.js'),
          corePath: chrome.runtime.getURL('tesseract-core.wasm.js'),
          logger: m => {}
        });
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
        sched.addWorker(worker);
      }
      return sched;
    })();
  }
  return schedulerPromise;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') {
    return false;
  }

  if (message.type === 'ping') {
    sendResponse({ success: true });
    return false; // synchronous response
  }

  if (message.type === 'parsePdf') {
    handleParsePdf(message.candidateId)
      .then(text => {
        sendResponse({ success: true, text });
      })
      .catch(error => {
        const errorMsg = typeof error === 'object' ? (error.message || JSON.stringify(error, Object.getOwnPropertyNames(error))) : String(error);
        sendResponse({ success: false, error: errorMsg });
      });
    return true; // async response
  }

  if (message.type === 'recognizeImage') {
    handleRecognizeImage(message.data)
      .then(text => sendResponse({ success: true, text }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // async response
  }
});

async function handleParsePdf(candidateId) {
  try {
    await ensureDb();
    const rawResume = await dbManager.getRawResume(candidateId);
    if (!rawResume || !rawResume.data) {
      throw new Error(`Raw resume not found in DB for candidate ${candidateId}`);
    }

    const dataBuffer = rawResume.data; // ArrayBuffer from DB
    const bytes = new Uint8Array(dataBuffer);
    
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    let fullText = '';

    const pagePromises = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');

      if (pageText.trim().length < 20) {
        // Likely an image-based page. Use OCR.
        const viewport = page.getViewport({ scale: 1.5 }); // Lower scale to save memory/speed up
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;

        // Use JPEG to drastically reduce dataUrl string size and memory
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        
        // Queue the OCR job but DO NOT await it yet!
        const ocrPromise = handleRecognizeImage(dataUrl);
        pagePromises.push(ocrPromise);
        
        // Clean up
        page.cleanup();
      } else {
        pagePromises.push(Promise.resolve(pageText));
      }
    }
    
    // Wait for all pages to finish processing (concurrently for OCR)
    const pageTexts = await Promise.all(pagePromises);
    fullText = pageTexts.join('\n');
    
    // Clean up
    pdf.destroy();

    if (fullText.trim().length < 50) {
      throw new Error("Insufficient text content parsed.");
    }

    return fullText;
  } catch (error) {
    const errorDetails = typeof error === 'object' ? JSON.stringify(error, Object.getOwnPropertyNames(error)) : error;
    console.error('Error during PDF parsing in offscreen document:', error, errorDetails);
    throw error;
  }
}

async function handleRecognizeImage(dataUrl) {
  try {
    const sched = await getScheduler();
    const { data: { text } } = await sched.addJob('recognize', dataUrl);
    return text;
  } catch (error) {
    console.error('Error during OCR in offscreen document:', error);
    throw error;
  }
}
