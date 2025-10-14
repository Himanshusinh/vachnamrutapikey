# Vachanamrut Voice Companion - Technical Documentation

## 📋 Overview

The Vachanamrut Voice Companion is a Next.js application that allows users to ask questions about the Vachanamrut scripture using voice input and receive spoken answers in English or Gujarati.

---

## 🤖 AI Models Used

### 1. **Text Generation Model**

- **Model Name:** `gemini-2.5-flash-preview-05-20`
- **API Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent`
- **Purpose:** Understanding questions and generating answers about Vachanamrut teachings
- **Provider:** Google AI Studio (Gemini API)

#### Configuration:

```typescript
{
  temperature: 0.7,           // Controls randomness (0-1)
  maxOutputTokens: 2048,      // Maximum response length
  candidateCount: 1           // Number of response variations
}
```

#### Features Used:

- **Multilingual Support:** Understands and responds in both English and Gujarati
- **Context Understanding:** Specialized prompt engineering to focus only on Vachanamrut topics
- **Thinking Mode:** Uses extended thinking tokens for better reasoning

---

### 2. **Text-to-Speech (TTS) Model**

- **Model Name:** `gemini-2.5-flash-preview-tts`
- **API Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent`
- **Purpose:** Converting text answers to spoken audio
- **Provider:** Google AI Studio (Gemini API)

#### Configuration:

```typescript
{
  generationConfig: {
    responseModalities: ['audio'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: 'Puck'
        }
      }
    }
  }
}
```

#### Audio Output Format:

- **Original Format:** `audio/L16;codec=pcm;rate=24000` (Raw PCM)
- **Converted To:** `audio/wav` (WAV format with proper headers)
- **Sample Rate:** 24,000 Hz
- **Channels:** Mono (1 channel)
- **Bits per Sample:** 16-bit

---

## 🏗️ Application Architecture

### Frontend (Next.js + React)

```
app/
├── page.tsx              # Main UI component
├── layout.tsx            # App layout
├── globals.css           # Global styles
└── api/
    ├── gemini/
    │   └── route.ts      # Text generation API route
    └── tts/
        └── route.ts      # Text-to-speech API route
```

### Key Components:

#### 1. **Voice Input (Speech-to-Text)**

- **Technology:** Browser Web Speech API
- **API:** `SpeechRecognition` / `webkitSpeechRecognition`
- **Language:** `gu-IN` (Gujarati + English in India)
- **Mode:** Single-shot recognition (not continuous)

```typescript
const recognition = new SpeechRecognition();
recognition.lang = "gu-IN";
recognition.continuous = false;
recognition.interimResults = false;
```

#### 2. **AI Processing Pipeline**

**Flow:**

```
User Voice Input → Browser STT → Text Query → Gemini API → Text Answer → TTS API → Audio → Browser Playback
```

**Steps:**

1. User taps microphone
2. Browser captures voice and converts to text
3. Text sent to `/api/gemini` endpoint
4. Gemini model generates answer
5. Answer sent to `/api/tts` endpoint
6. TTS generates PCM audio
7. Frontend converts PCM to WAV
8. Audio plays in browser

#### 3. **PCM to WAV Conversion**

The TTS API returns raw PCM audio which browsers cannot play directly. A custom converter creates a WAV file:

```typescript
function pcmToWav(pcmData: Uint8Array, sampleRate = 24000) {
  // Creates 44-byte WAV header
  const wavHeader = new ArrayBuffer(44);

  // RIFF identifier
  // File length
  // WAVE format
  // fmt chunk
  // PCM format specifications
  // data chunk

  // Combines header + PCM data
  return new Blob([headerArray, pcmData], { type: "audio/wav" });
}
```

---

## 🔑 API Configuration

### Environment Variables

**File:** `.env.local`

```bash
GOOGLE_AI_API_KEY=your_api_key_here
```

### API Routes

#### `/api/gemini` - Text Generation

```typescript
POST /api/gemini
Content-Type: application/json

Request Body:
{
  "query": "What is the Vachanamrut?"
}

Response:
{
  "answer": "The Vachanamrut is a collection of 273..."
}
```

#### `/api/tts` - Text-to-Speech

```typescript
POST /api/tts
Content-Type: application/json

Request Body:
{
  "text": "The Vachanamrut is a sacred scripture..."
}

Response:
{
  "audio": "base64_encoded_pcm_data",
  "mimeType": "audio/wav",
  "originalMimeType": "audio/L16;codec=pcm;rate=24000"
}
```

---

## 🎯 AI Prompt Strategy

### System Prompt Structure:

```
Role: Specialist in Vachanamrut scripture only

Context:
- 273 spiritual discourses by Bhagwan Swaminarayan (1819-1829)
- Topics: dharma, bhakti, moksha, nature of God

Rules:
1. ONLY answer Vachanamrut-related questions
2. Politely decline non-Vachanamrut questions
3. Match response language to question language
4. Be respectful and reverent

Rejection Template:
- English: "I can only answer questions about the Vachanamrut..."
- Gujarati: "માફ કરશો, પરંતુ હું ફક્ત વચનામૃત..."
```

### Accepted Topics:

- Vachanamrut content and teachings
- Bhagwan Swaminarayan's life and philosophy
- Dharma, bhakti, moksha concepts
- Spiritual practices from Vachanamrut
- Satsang and related concepts

### Rejected Topics:

- General knowledge
- Current events
- Other religious texts
- Science/technology
- Entertainment
- Anything outside Vachanamrut scope

---

## 🔊 Audio Processing Details

### 1. **TTS Response Format**

```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "inlineData": {
              "mimeType": "audio/L16;codec=pcm;rate=24000",
              "data": "base64_encoded_audio"
            }
          }
        ]
      }
    }
  ],
  "usageMetadata": {
    "candidatesTokensDetails": [
      {
        "modality": "AUDIO",
        "tokenCount": 1197
      }
    ]
  }
}
```

### 2. **WAV Header Specifications**

```
Bytes 0-3:   "RIFF" identifier
Bytes 4-7:   File size (36 + data length)
Bytes 8-11:  "WAVE" format
Bytes 12-15: "fmt " chunk marker
Bytes 16-19: Format chunk length (16)
Bytes 20-21: Audio format (1 = PCM)
Bytes 22-23: Number of channels (1 = mono)
Bytes 24-27: Sample rate (24000 Hz)
Bytes 28-31: Byte rate (48000)
Bytes 32-33: Block align (2)
Bytes 34-35: Bits per sample (16)
Bytes 36-39: "data" chunk identifier
Bytes 40-43: Data chunk size
Bytes 44+:   PCM audio data
```

---

## 📊 Token Usage & Performance

### Text Generation (Gemini 2.5 Flash Preview)

- **Input:** ~245 tokens (prompt + question)
- **Output:** Up to 2048 tokens
- **Thinking Tokens:** ~1500 tokens (internal reasoning)
- **Total:** ~3800 tokens per request

### Text-to-Speech (Gemini TTS)

- **Input:** Text length (varies)
- **Audio Tokens:** ~1200 tokens for typical response
- **Response Time:** 15-25 seconds for full generation

---

## 🚀 Features

### Core Functionality

1. ✅ **Voice Input** - Browser-based speech recognition
2. ✅ **AI Processing** - Gemini API for understanding and generation
3. ✅ **Voice Output** - Gemini TTS with PCM to WAV conversion
4. ✅ **Bilingual Support** - English and Gujarati
5. ✅ **Topic Restriction** - Only Vachanamrut-related content
6. ✅ **Audio Controls** - Stop button to interrupt playback
7. ✅ **Chat History** - Saves conversation for reference

### User Interface

- Responsive design with Tailwind CSS
- Orange/blue spiritual theme
- Real-time status indicators:
  - 🎤 Listening (red pulsing)
  - 🤔 Processing (blue)
  - 🔊 Speaking (green)
- Stop button (appears during playback)
- Chat history panel

---

## 🔧 Setup Instructions

### Prerequisites

- Node.js 18+
- Google AI Studio API Key

### Installation

1. **Clone or create project:**

```bash
npx create-next-app@latest vachnamrut-companion
cd vachnamrut-companion
```

2. **Install dependencies:**

```bash
npm install
```

3. **Configure API Key:**

Create `.env.local`:

```bash
GOOGLE_AI_API_KEY=your_google_ai_studio_key
```

Or use the fallback in code (for development):

```typescript
const apiKey = process.env.GOOGLE_AI_API_KEY || "your_key_here";
```

4. **Run development server:**

```bash
npm run dev
```

5. **Open browser:**

```
http://localhost:3000
```

---

## 🎨 Customization Options

### Change TTS Voice

```typescript
// In app/api/tts/route.ts
speechConfig: {
  voiceConfig: {
    prebuiltVoiceConfig: {
      voiceName: "Puck"; // Change to other available voices
    }
  }
}
```

### Adjust Response Length

```typescript
// In app/api/gemini/route.ts
generationConfig: {
  maxOutputTokens: 2048; // Increase for longer responses
}
```

### Change Recognition Language

```typescript
// In app/page.tsx
recognition.lang = "gu-IN"; // Change to 'en-US', 'hi-IN', etc.
```

---

## 🐛 Troubleshooting

### Issue: No Audio Output

**Solution:** The app automatically converts PCM to WAV. Ensure browser supports audio playback.

### Issue: API Key Not Loading

**Solution:** Restart dev server after creating `.env.local` or use the fallback in code.

### Issue: Speech Recognition Not Working

**Solution:** Use Chrome/Edge browser. Firefox has limited support. Ensure microphone permissions.

### Issue: Wrong Language Response

**Solution:** The model auto-detects language. Ensure question is clearly in one language.

---

## 📈 Performance Optimization

### Current Optimizations:

1. **Thinking Tokens:** Enabled for better accuracy (increases latency)
2. **Audio Streaming:** Not implemented (could reduce TTS latency)
3. **Caching:** Not implemented (could reduce API costs)

### Potential Improvements:

1. Implement audio streaming for faster playback
2. Add response caching for common questions
3. Use edge functions for faster API routes
4. Implement conversation context for follow-up questions

---

## 📝 API Rate Limits

### Google AI Studio (Free Tier)

- **Requests per minute:** 60
- **Tokens per minute:** 32,000
- **Requests per day:** 1,500

For production, consider Google Cloud Vertex AI for higher limits.

---

## 🔐 Security Considerations

1. **API Key Protection:** Never commit `.env.local` to Git
2. **Input Validation:** Queries are validated before API calls
3. **Error Handling:** All API errors are caught and logged
4. **CORS:** Next.js API routes are server-side (no CORS issues)

---

## 📚 Technologies Used

- **Framework:** Next.js 15.5.4 (Turbopack)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **AI Models:** Google Gemini 2.5 Flash (Text + TTS)
- **Speech Recognition:** Web Speech API
- **Audio Processing:** Custom PCM to WAV converter

---

## 📞 Support & Resources

- **Gemini API Docs:** https://ai.google.dev/docs
- **Next.js Docs:** https://nextjs.org/docs
- **Web Speech API:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API

---

## 📄 License

This documentation is provided as-is for the Vachanamrut Voice Companion project.

---

**Created:** October 2024  
**Last Updated:** October 2024  
**Version:** 1.0.0
