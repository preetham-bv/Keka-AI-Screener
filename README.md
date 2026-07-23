# Keka ATS AI Reviewer 🧠💼

Welcome to the **Keka ATS AI Reviewer**! 

This is a simple Chrome Extension that acts as your personal AI recruiting assistant. It lives right inside your browser and helps you evaluate candidate resumes on the Keka ATS (Applicant Tracking System) in seconds.

Instead of manually reading every resume, this extension reads them for you, grades them against your specific hiring criteria, and automatically posts the results as notes on the candidate's Keka profile.

## ✨ What It Does

- **Reads Resumes Instantly:** Automatically pulls the candidate's resume directly from their Keka profile (works with both PDFs and scanned images).
- **Smart AI Screening:** Connects to powerful AI models (like ChatGPT, Claude, or Google Gemini) to evaluate the candidate exactly how you would.
- **Auto-Tagging:** Automatically adds a "Reject" or "Advance" decision, a confidence score, and specific tags (like `No B2B Experience`) straight into Keka.
- **Private & Secure:** Your data and API keys stay on your computer. Your custom prompts and knowledge bases are never shared online.

## 🚀 How to Install

Even if you aren't a programmer, installing this takes just one minute!

1. **Download this folder:** 
   Click the green **"Code"** button at the top right of this GitHub page and select **"Download ZIP"**. Extract the downloaded folder on your computer.
2. **Open Chrome Extensions:**
   Open Google Chrome, click the three dots in the top right corner, go to **Extensions**, and click **Manage Extensions** (or just type `chrome://extensions/` in your search bar).
3. **Turn on Developer Mode:**
   Toggle the **Developer mode** switch in the top right corner of the Extensions page.
4. **Load the Extension:**
   Click the **Load unpacked** button on the top left. Navigate to the folder you downloaded, and **select the `dist` folder** inside of it.

That's it! The Keka AI Reviewer icon will now appear in your Chrome toolbar.

## ⚙️ How to Setup & Use

1. **Add Your AI Key:**
   Click the new extension icon in your Chrome toolbar. Go to the **Settings** tab and paste in your API Key (from OpenAI, Anthropic, or Google). 
2. **Add Your Rules:**
   Go to the **Knowledge Base** tab to add your company's specific job descriptions and rules for grading candidates.
3. **Screen a Candidate:**
   Open any candidate's profile on Keka. Click the extension icon and hit **Run Screen**. The AI will do the rest and automatically add notes to Keka!

---
*(Note for developers: If you wish to edit the code in the main folder, you will need to install Node.js and run `npm install` and `npm run build` to generate a new `dist` folder.)*
