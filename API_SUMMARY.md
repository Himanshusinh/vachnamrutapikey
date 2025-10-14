# 🔌 API Summary - Vachanamrut Voice Companion

## Quick Reference

### Models Used

| Component        | Model Name                       | Purpose                                    |
| ---------------- | -------------------------------- | ------------------------------------------ |
| **Text AI**      | `gemini-2.5-flash-preview-05-20` | Question understanding & answer generation |
| **Voice AI**     | `gemini-2.5-flash-preview-tts`   | Text-to-speech conversion                  |
| **Speech Input** | Browser Web Speech API           | Voice-to-text (STT)                        |

---

## 1. Text Generation API

### Endpoint

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent
```

### Request Format

```json
{
  "contents": [
    {
      "parts": [
        {
          "text": "System prompt + User question"
        }
      ]
    }
  ],
  "generationConfig": {
    "temperature": 0.7,
    "maxOutputTokens": 2048,
    "candidateCount": 1
  }
}
```

### Response Format

```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "text": "Answer text here"
          }
        ],
        "role": "model"
      },
      "finishReason": "STOP"
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 245,
    "candidatesTokenCount": 534,
    "totalTokenCount": 2054,
    "thoughtsTokenCount": 1512
  }
}
```

### Key Features

- **Bilingual:** Responds in the same language as the question (English/Gujarati)
- **Focused:** Only answers Vachanamrut-related questions
- **Thinking Mode:** Uses internal reasoning for better answers

---

## 2. Text-to-Speech API

### Endpoint

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent
```

### Request Format

```json
{
  "contents": [
    {
      "parts": [
        {
          "text": "Text to convert to speech"
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["audio"],
    "speechConfig": {
      "voiceConfig": {
        "prebuiltVoiceConfig": {
          "voiceName": "Puck"
        }
      }
    }
  }
}
```

### Response Format

```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "inlineData": {
              "mimeType": "audio/L16;codec=pcm;rate=24000",
              "data": "base64_encoded_audio_data"
            }
          }
        ],
        "role": "model"
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

### Audio Specifications

- **Format:** PCM (Linear 16-bit)
- **Sample Rate:** 24,000 Hz
- **Channels:** 1 (Mono)
- **Conversion:** Automatically converted to WAV in frontend

---

## 3. Speech Recognition (Browser)

### API Used

```javascript
const recognition = new (window.SpeechRecognition ||
  window.webkitSpeechRecognition)();
```

### Configuration

```javascript
recognition.lang = "gu-IN"; // Gujarati + English (India)
recognition.continuous = false; // Single utterance
recognition.interimResults = false; // Only final results
```

### Browser Support

- ✅ Chrome/Edge (Full support)
- ✅ Safari (Partial support)
- ❌ Firefox (Limited support)

---

## 4. Local API Routes (Next.js)

### `/api/gemini` - Text Generation

**Request:**

```bash
POST http://localhost:3000/api/gemini
Content-Type: application/json

{
  "query": "What is the Vachanamrut?"
}
```

**Response:**

```json
{
  "answer": "The Vachanamrut is a collection of 273 spiritual discourses..."
}
```

**Error Response:**

```json
{
  "error": "Error message here"
}
```

---

### `/api/tts` - Text-to-Speech

**Request:**

```bash
POST http://localhost:3000/api/tts
Content-Type: application/json

{
  "text": "The Vachanamrut is a sacred scripture..."
}
```

**Response:**

```json
{
  "audio": "base64_encoded_audio_data",
  "mimeType": "audio/wav",
  "originalMimeType": "audio/L16;codec=pcm;rate=24000"
}
```

**Error Response:**

```json
{
  "error": "Error message here"
}
```

---

## 5. Audio Processing

### PCM to WAV Conversion (Frontend)

The TTS API returns raw PCM audio which browsers cannot play. A custom function converts it:

```typescript
function pcmToWav(pcmData: Uint8Array, sampleRate = 24000): Blob {
  // Create 44-byte WAV header
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  // Write WAV header fields
  view.setUint32(0, 0x52494646); // "RIFF"
  view.setUint32(4, 36 + pcmData.length);
  view.setUint32(8, 0x57415645); // "WAVE"
  // ... (complete header setup)

  // Combine header + PCM data
  return new Blob([headerArray, pcmData], { type: "audio/wav" });
}
```

### WAV Format Specs

- **Container:** RIFF/WAVE
- **Format:** PCM
- **Sample Rate:** 24,000 Hz
- **Bit Depth:** 16-bit
- **Channels:** Mono (1)
- **Byte Order:** Little-endian

---

## 6. Authentication

### API Key Setup

**Environment Variable (.env.local):**

```bash
GOOGLE_AI_API_KEY=AIzaSy...your_key_here
```

**Usage in Code:**

```typescript
const apiKey = process.env.GOOGLE_AI_API_KEY;

// Or with fallback (development only):
const apiKey = process.env.GOOGLE_AI_API_KEY || "AIzaSy...";
```

**API Key Format:**

- Prefix: `AIzaSy`
- Length: 39 characters
- Source: [Google AI Studio](https://aistudio.google.com/app/apikey)

---

## 7. Rate Limits (Google AI Studio - Free Tier)

| Limit Type          | Value  |
| ------------------- | ------ |
| Requests per minute | 60     |
| Tokens per minute   | 32,000 |
| Requests per day    | 1,500  |

**Recommendation:** For production, upgrade to Google Cloud Vertex AI for higher limits.

---

## 8. Error Handling

### Common Errors

| Error               | Cause             | Solution                 |
| ------------------- | ----------------- | ------------------------ |
| 404 Model Not Found | Wrong model name  | Check model availability |
| 401 Unauthorized    | Invalid API key   | Verify API key           |
| 429 Rate Limit      | Too many requests | Implement throttling     |
| 500 Server Error    | API issue         | Retry with backoff       |

### Error Response Format

```json
{
  "error": {
    "code": 404,
    "message": "Model not found",
    "status": "NOT_FOUND"
  }
}
```

---

## 9. Performance Metrics

### Typical Response Times

| Operation          | Time          | Tokens       |
| ------------------ | ------------- | ------------ |
| Text Generation    | 2-5 seconds   | ~2,000 total |
| TTS Generation     | 15-25 seconds | ~1,200 audio |
| Speech Recognition | 1-2 seconds   | N/A          |
| Total Round Trip   | 20-30 seconds | ~3,200       |

### Optimization Opportunities

- Implement streaming for faster TTFB
- Cache common responses
- Use edge functions for lower latency

---

## 10. Data Flow

```
User speaks → Browser STT → Text Query
                              ↓
                          /api/gemini
                              ↓
                    Gemini 2.5 Flash API
                              ↓
                         Text Answer
                              ↓
                          /api/tts
                              ↓
                    Gemini TTS API
                              ↓
                     PCM Audio (base64)
                              ↓
                    Frontend Converter
                              ↓
                      WAV Audio Blob
                              ↓
                    Browser Audio Player
                              ↓
                         User hears
```

---

## 11. Security Best Practices

1. ✅ **Never commit API keys** - Use `.env.local`
2. ✅ **Server-side API calls** - Next.js API routes hide keys
3. ✅ **Input validation** - Check query before API call
4. ✅ **Error masking** - Don't expose internal errors to client
5. ✅ **Rate limiting** - Implement request throttling
6. ✅ **HTTPS only** - Use secure connections in production

---

## 12. Testing the APIs

### Test Text Generation

```bash
curl -X POST \
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "contents": [{
      "parts": [{"text": "What is the Vachanamrut?"}]
    }]
  }'
```

### Test TTS

```bash
curl -X POST \
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "contents": [{
      "parts": [{"text": "Hello world"}]
    }],
    "generationConfig": {
      "responseModalities": ["audio"]
    }
  }'
```

### Test Local APIs

```bash
# Test Gemini endpoint
curl -X POST http://localhost:3000/api/gemini \
  -H 'Content-Type: application/json' \
  -d '{"query": "What is the Vachanamrut?"}'

# Test TTS endpoint
curl -X POST http://localhost:3000/api/tts \
  -H 'Content-Type: application/json' \
  -d '{"text": "Hello world"}'
```

---

**Last Updated:** October 2024  
**Version:** 1.0.0
