import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.js';
import Tesseract from 'tesseract.js';

// Inject worker directly to avoid pdf.js trying to load it via DOM <script> tags
globalThis.pdfjsWorker = pdfjsWorker;

export class ResumeParser {
  /**
   * Parse the candidate's resume buffer based on file type.
   * Keka often returns PDF or images.
   */
  static async parse(bufferOrBase64, contentType = 'application/pdf') {
    try {
      const typeStr = contentType.toLowerCase();
      let text = '';
      
      if (typeStr.includes('pdf')) {
        text = await this.parsePdf(bufferOrBase64);
      } else if (typeStr.includes('image')) {
        text = await this.parseImage(bufferOrBase64);
      } else if (typeStr.includes('json') || typeStr.includes('text/plain')) {
        const jsonStr = new TextDecoder().decode(bufferOrBase64);
        
        // Try parsing JSON or fallback to regex to find URL
        let fileUrl = null;
        try {
          const data = JSON.parse(jsonStr);
          
          // Helper to recursively find the first http(s) URL in the object
          const findUrl = (obj) => {
             if (typeof obj === 'string' && obj.startsWith('http')) return obj;
             if (typeof obj === 'object' && obj !== null) {
                for (const key of Object.keys(obj)) {
                   const res = findUrl(obj[key]);
                   if (res) return res;
                }
             }
             return null;
          };
          fileUrl = findUrl(data);
        } catch (e) {
          console.warn('Failed to parse resume buffer as JSON. Attempting regex extraction.');
        }

        // If JSON parsing didn't find it, try a broad regex
        if (!fileUrl) {
          const urlMatch = jsonStr.match(/https?:\/\/[^\s"']+/);
          if (urlMatch) fileUrl = urlMatch[0];
        }

        if (fileUrl) {
           console.log(`Found file URL in JSON payload: ${fileUrl}. Fetching actual document...`);
           const fileResponse = await fetch(fileUrl);
           if (!fileResponse.ok) {
             throw new Error(`Failed to fetch document from extracted URL: ${fileResponse.statusText}`);
           }
           const fileBuffer = await fileResponse.arrayBuffer();
           const fileContentType = fileResponse.headers.get('content-type') || 'application/pdf';
           // Recursively parse the downloaded file
           return await this.parse(fileBuffer, fileContentType);
        }

        // If no URL found, just return the raw text
        text = jsonStr;
      } else {
        text = new TextDecoder().decode(bufferOrBase64);
      }
      
      return text;
    } catch (error) {
      console.error('Parser error:', error);
      throw error;
    }
  }

  /**
   * Parse PDF using pdf.js
   */
  static async parsePdf(arrayBuffer) {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;
    let fullText = '';
    let tesseractWorker = null;
    
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        
        if (pageText.trim().length < 20) {
          // Likely an image-based page. Use OCR fallback.
          console.log(`Page ${i} has sparse text (${pageText.trim().length} chars). Falling back to OCR...`);
          if (!tesseractWorker) {
            tesseractWorker = await Tesseract.createWorker({
              workerPath: chrome.runtime.getURL('tesseract.worker.min.js'),
              logger: m => console.log('Tesseract OCR (PDF Fallback):', m.status, Math.round(m.progress * 100) + '%')
            });
            await tesseractWorker.loadLanguage('eng');
            await tesseractWorker.initialize('eng');
          }
          
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = new OffscreenCanvas(viewport.width, viewport.height);
          const context = canvas.getContext('2d');
          
          const renderContext = {
            canvasContext: context,
            viewport: viewport
          };
          
          await page.render(renderContext).promise;
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          const { data: { text } } = await tesseractWorker.recognize(blob);
          fullText += text + '\n';
        } else {
          fullText += pageText + '\n';
        }
      }
    } finally {
      if (tesseractWorker) {
        await tesseractWorker.terminate();
      }
    }
    
    if (fullText.trim().length < 50) {
      throw new Error("Insufficient text content parsed. The resume might be an image-only PDF without a text layer, and OCR failed to extract meaningful text, or the file is corrupted.");
    }
    
    return fullText;
  }

  /**
   * Parse Image using Tesseract.js
   */
  static async parseImage(arrayBuffer) {
    // Tesseract expects a File/Blob or Image element.
    const uint8arr = new Uint8Array(arrayBuffer);
    const blob = new Blob([uint8arr], { type: 'image/png' }); // Assume PNG, Tesseract handles various formats
    
    // Configure Tesseract to use local worker files copied to dist/
    const worker = await Tesseract.createWorker({
      workerPath: chrome.runtime.getURL('tesseract.worker.min.js'),
      // Core paths might still require CDN if not fully offline bundled,
      // but tesseract.js defaults to unpkg for core files.
      logger: m => console.log('Tesseract:', m.status, Math.round(m.progress * 100) + '%')
    });
    
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    const { data: { text } } = await worker.recognize(blob);
    await worker.terminate();
    
    return text;
  }
}
