# Keka ATS AI Reviewer 🧠💼

A powerful, event-driven Chrome Extension designed to seamlessly integrate an AI-powered candidate screening pipeline directly into the Keka ATS (Applicant Tracking System). 

This extension automates the tedious parts of startup hiring by evaluating candidate resumes against a strict, evidence-based rubric and automatically syncing the AI's decision, confidence score, and contextual tags straight back into your Keka dashboard.

## ✨ Features

- **Automated Resume Parsing:** Instantly extracts and reads candidate resumes directly from Keka—whether they are PDFs (via `pdf.js`) or image-based scans (via `tesseract.js` OCR).
- **Evidence-Based AI Screening:** Connects securely to major LLM providers (Anthropic Claude, OpenAI, Google Gemini) to evaluate candidates against a highly-specific, startup-focused rubric.
- **Auto-Tagging System:** Automatically structures the AI's evaluation into strict tags (e.g., `AI: REJECT`, `Confidence: HIGH`, `No B2B Experience`) and posts them as internal notes onto the candidate's Keka profile.
- **Event-Driven Architecture:** Built with a resilient multi-worker pipeline (Workers A through F) that handles fetching, parsing, evaluating, extracting, and syncing asynchronously without slowing down your browser.
- **Beautiful Glassmorphism UI:** Features a sleek, modern popup interface complete with micro-animations, progress bars, and localized settings for API keys and prompt management.
- **Zero-Setup Distribution:** The entire built extension is included in the repository. No complex build pipelines required for end-users to start evaluating candidates.

## 🛠️ Tech Stack

- **Core:** Vanilla JavaScript (ES6+), HTML5, CSS3
- **Bundler:** Webpack (with Babel for transpilation)
- **Document Processing:** PDF.js (PDF reading), Tesseract.js (Optical Character Recognition for image resumes)
- **Storage:** Chrome IndexedDB & Sync Storage API
- **Design:** Custom Glassmorphism UI styling with dynamic SVG gradients

## 🚀 How to Install & Use

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/keka-ats-ai-reviewer.git
   ```
2. **Load into Chrome:**
   - Open Google Chrome and navigate to `chrome://extensions/`
   - Enable **Developer mode** in the top right corner.
   - Click **Load unpacked** and select the **`dist`** folder inside the cloned repository.
3. **Configure the AI:**
   - Click on the new Keka extension icon in your toolbar.
   - Navigate to the **Settings** tab and enter your preferred API key (Anthropic, OpenAI, or Gemini).
4. **Start Evaluating:**
   - Go to any candidate's profile on your Keka ATS.
   - Click the extension icon and hit **Run Screen** to kick off the automated pipeline!

## 🧑‍💻 Development

If you want to modify the source code, you'll need to rebuild the `dist` folder:

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the extension:
   ```bash
   npm run build
   ```
   *(Or use `npm run watch` to automatically rebuild on save during development).*

## 🔒 Privacy & Security

This extension runs completely locally within your browser. Resumes are parsed locally using bundled libraries, and data is only ever transmitted directly between your machine and your chosen AI provider's official API. No intermediate servers are used.
