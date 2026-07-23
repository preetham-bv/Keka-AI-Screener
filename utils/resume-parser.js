import { setupOffscreenDocument } from './offscreen-setup.js';
import { dbManager } from '../services/instances.js';

export class ResumeParser {
  /**
   * Parse the candidate's resume buffer based on file type.
   * Keka often returns PDF or images.
   */
  static async parse(bufferOrBase64, contentType = 'application/pdf', candidateId = null) {
    try {
      const typeStr = contentType.toLowerCase();
      let text = '';
      
      if (typeStr.includes('pdf')) {
        text = await this.parsePdf(bufferOrBase64, candidateId);
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
           
           if (candidateId) {
             // Save the actual downloaded document over the JSON payload in DB
             // so the offscreen document can fetch the actual PDF buffer
             await dbManager.storeRawResume(candidateId, { 
               data: fileBuffer, 
               contentType: fileContentType 
             });
           }

           // Recursively parse the downloaded file
           return await this.parse(fileBuffer, fileContentType, candidateId);
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
   * Helper function to convert ArrayBuffer to Base64
   */
  static bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Helper function to send message to offscreen document with timeout
   */
  static async sendMessageWithTimeout(message, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
      let isSettled = false;
      const timeoutId = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          // Attempt to reset offscreen document state by closing it
          chrome.offscreen.closeDocument().catch(() => {});
          reject(new Error(`Parsing timed out after ${timeoutMs / 1000} seconds. The background parser might have crashed.`));
        }
      }, timeoutMs);

      chrome.runtime.sendMessage(message, (response) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      });
    });
  }

  /**
   * Parse PDF using offscreen document
   */
  static async parsePdf(arrayBuffer, candidateId) {
    if (!candidateId) {
      throw new Error('candidateId is strictly required for parsePdf in this architecture');
    }

    await setupOffscreenDocument('pages/offscreen.html');
    const response = await this.sendMessageWithTimeout({
      target: 'offscreen',
      type: 'parsePdf',
      candidateId: candidateId
    }, 120000); // 2 minute timeout for PDF parsing

    if (response && response.success) {
      return response.text;
    } else {
      throw new Error(response?.error || 'Unknown PDF parsing error in offscreen document');
    }
  }

  /**
   * Parse Image using Tesseract.js via Offscreen Document
   */
  static async parseImage(arrayBuffer) {
    const base64Data = this.bufferToBase64(arrayBuffer);
    const dataUrl = `data:image/png;base64,${base64Data}`; // Assuming PNG, offscreen might not care

    await setupOffscreenDocument('pages/offscreen.html');
    const response = await this.sendMessageWithTimeout({
      target: 'offscreen',
      type: 'recognizeImage',
      data: dataUrl
    }, 60000); // 1 minute timeout for single image OCR
    
    if (response && response.success) {
      return response.text;
    } else {
      throw new Error(response?.error || 'Unknown OCR error in offscreen document');
    }
  }
}
