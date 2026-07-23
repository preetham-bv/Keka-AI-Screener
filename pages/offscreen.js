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
  let keepAliveInterval = null;
  try {
    await ensureDb();
    const rawResume = await dbManager.getRawResume(candidateId);
    if (!rawResume || !rawResume.data) {
      throw new Error(`Raw resume not found in DB for candidate ${candidateId}`);
    }

    const bytes = new Uint8Array(rawResume.data);
    
    // Start a keep-alive interval to prevent the Service Worker from dying 
    // during long OCR tasks (Chrome kills idle SWs after 30s)
    keepAliveInterval = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'offscreen_keepAlive', candidateId });
    }, 15000);

    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    let fullText = '';

    const pagePromises = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      let textContent;
      try {
        // Timeout getTextContent after 10 seconds. Malformed fonts in resume builders can cause infinite loops here.
        textContent = await Promise.race([
          page.getTextContent(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('getTextContent timeout')), 10000))
        ]);
      } catch (err) {
        console.warn('getTextContent failed or timed out:', err);
        textContent = { items: [] }; // Fallback to OCR if text extraction hangs
      }
      
      const pageText = textContent.items.map(item => item.str).join(' ');

      if (pageText.trim().length < 20) {
        // Likely an image-based page. Use OCR.
        const viewport = page.getViewport({ scale: 1.0 }); // Lower scale to 1.0 to reduce memory footprint and speed up parsing
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        
        const renderTask = page.render({
          canvasContext: context,
          viewport: viewport
        });

        // Timeout page.render after 30 seconds to prevent hangs on complex vectors (Canva resumes)
        try {
          await Promise.race([
            renderTask.promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('page.render timeout')), 30000))
          ]);
        } catch (err) {
          console.warn('page.render failed or timed out:', err);
          renderTask.cancel();
          page.cleanup();
          pagePromises.push(Promise.resolve(''));
          continue; // Skip OCR for this page if render fails
        }

        // Check if canvas is completely blank (solid color) to skip OCR on empty pages
        let isBlank = true;
        try {
          const pixelBuffer = new Uint32Array(context.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
          if (pixelBuffer.length > 0) {
            const firstPixel = pixelBuffer[0];
            for (let p = 1; p < pixelBuffer.length; p+=100) { // Check every 100th pixel for speed
              if (pixelBuffer[p] !== firstPixel) {
                isBlank = false;
                break;
              }
            }
          }
        } catch (e) {
          // Ignore ImageData errors (e.g., tainted canvas, though shouldn't happen here)
          isBlank = false; 
        }

        if (isBlank) {
          console.log('Skipping OCR for blank page.');
          page.cleanup();
          pagePromises.push(Promise.resolve(''));
          continue;
        }

        // Use JPEG to drastically reduce dataUrl string size and memory
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        
        // AWAIT the OCR job sequentially to prevent OOM crashes on large PDFs!
        try {
          // Timeout Tesseract after 45 seconds per page
          const ocrText = await Promise.race([
            handleRecognizeImage(dataUrl),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Tesseract timeout')), 45000))
          ]);
          pagePromises.push(Promise.resolve(ocrText));
        } catch (err) {
          console.warn('OCR failed or timed out:', err);
          pagePromises.push(Promise.resolve(''));
        }
        
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

    clearInterval(keepAliveInterval);
    return fullText;
  } catch (error) {
    clearInterval(keepAliveInterval);
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
