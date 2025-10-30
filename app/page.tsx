'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// Type definitions for Speech Recognition API
interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  length: number;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

export default function VachanamrutCompanion() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [displayResponse, setDisplayResponse] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Array<{ query: string; answer: string }>>([]);
  type CachedTtsPart = { audio: string; mimeType: string; originalMimeType?: string };
  type QaCacheEntry = { question: string; answer: string; ttsParts: CachedTtsPart[] };
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const speakCancelRef = useRef<boolean>(false);
  const ttsWarmedUpRef = useRef<boolean>(false);
  const ttsCancelPrefetchRef = useRef<() => void>(() => {});
  const ttsStartedRef = useRef<boolean>(false);
  const ttsCursorRef = useRef<number>(0); // index in `response` up to which TTS has been spoken
  const streamingDoneRef = useRef<boolean>(false);
  const ttsCooldownUntilRef = useRef<number>(0); // epoch ms until which TTS calls should wait

  // Voice capture helpers
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTranscriptRef = useRef<string>('');
  const hasFinalizedRef = useRef<boolean>(false);

  const processQuery = useCallback(async (query: string) => {
    setIsProcessing(true);
    setError('');

    try {
      // 0) Try cache first
      const cached = getFromQaCache(query);
      if (cached) {
        const { answer, ttsParts } = cached;
        setHistory(prev => [...prev, { query, answer }]);
        // Show only after complete
        setResponse('');
        setDisplayResponse(answer);
        // Speak from cache if available; otherwise synthesize now and append to cache
        if (ttsParts && ttsParts.length > 0) {
          await speakFromCachedParts(ttsParts);
        } else {
          console.log('Cache hit without audio; synthesizing TTS now');
          streamAnswerWithParallelTts(answer, query);
        }
        return;
      }

      // Get answer from Gemini API
      const geminiResponse = await fetch('/api/gemini', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!geminiResponse.ok) {
        throw new Error('Failed to get response from AI');
      }

      const { answer } = await geminiResponse.json();

      // Add to history immediately (we still stream the UI)
      setHistory(prev => [...prev, { query, answer }]);

      // Save a provisional cache entry immediately (audio parts will append)
      trySaveToQaCache(query, answer, [], /*append*/ false);

      // Stream the answer in UI and start TTS
      streamAnswerWithParallelTts(answer, query);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  useEffect(() => {
    // Initialize Speech Recognition
    if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      const SpeechRecognition = (window as SpeechRecognitionWindow).SpeechRecognition || (window as SpeechRecognitionWindow).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true; // allow ongoing results
      recognitionRef.current.interimResults = true; // we want interim to track pauses
      recognitionRef.current.lang = 'gu-IN'; // Gujarati + English (India)

      recognitionRef.current.onresult = async (event: SpeechRecognitionEvent) => {
        let finalText = '';
        let interimText = '';
        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          const txt = res[0]?.transcript || '';
          if (res.isFinal) finalText += (finalText ? ' ' : '') + txt;
          else interimText += (interimText ? ' ' : '') + txt;
        }

        const combined = [finalText, interimText].filter(Boolean).join(' ');
        pendingTranscriptRef.current = combined.trim();
        setTranscript(pendingTranscriptRef.current);

        // Reset the 3s silence timer on each new result
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => finalizeVoiceQuestion(), 3000);
      };

      recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error);
        setError(`Voice recognition error: ${event.error}`);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        // If recognition ends early, finalize if we have any text
        if (!hasFinalizedRef.current) {
          const hasText = pendingTranscriptRef.current.trim().length > 0;
          if (hasText) {
            // Submit immediately instead of waiting for the silence timer
            void finalizeVoiceQuestion();
          } else {
            setIsListening(false);
          }
        }
      };
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, [processQuery]);

  // Removed TTS warm-up to avoid consuming API quota unnecessarily

  const startListening = () => {
    if (recognitionRef.current) {
      setError('');
      setTranscript('');
      setResponse('');
      setDisplayResponse('');
      setIsListening(true);
      pendingTranscriptRef.current = '';
      hasFinalizedRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      recognitionRef.current.start();
    } else {
      setError('Speech recognition not supported in your browser');
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const finalizeVoiceQuestion = async () => {
    if (hasFinalizedRef.current) return;
    hasFinalizedRef.current = true;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    const text = pendingTranscriptRef.current.trim();
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
    if (text) await processQuery(text);
  };

  const speakResponse = async (text: string) => {
    console.log('Frontend: Starting TTS for text:', text.substring(0, 50) + '...');
    setIsSpeaking(true);
    speakCancelRef.current = false;

    try {
      const chunks = chunkTextForTts(text, 100);
      if (chunks.length === 0) {
        setIsSpeaking(false);
        return;
      }

      // Create a background prefetcher that continuously fetches next chunks while audio is playing
      const prefetcher = createTtsPrefetcher(chunks);
      ttsCancelPrefetchRef.current = prefetcher.cancel;

      const firstBlob = await prefetcher.next();
      if (!firstBlob || speakCancelRef.current) {
        prefetcher.cancel();
        setIsSpeaking(false);
        return;
      }

      const playLoop = async (initialBlob: Blob) => {
        let currentBlob: Blob | null = initialBlob;
        while (currentBlob && !speakCancelRef.current) {
          const audioUrl = URL.createObjectURL(currentBlob);
          const audioElement = new Audio(audioUrl);
          audioElementRef.current = audioElement;

          const nextBlobPromise = prefetcher.next(); // Start waiting for the next chunk while current plays

          const playPromise = audioElement.play();
          audioElement.onerror = (e) => {
            console.error('Frontend: Audio playback error:', e);
            setIsSpeaking(false);
            audioElementRef.current = null;
            setError('Failed to play audio');
          };

          await playPromise.catch((e) => {
            console.error('Frontend: Audio play() failed:', e);
            setIsSpeaking(false);
          });

          await new Promise<void>((resolve) => {
            audioElement.onended = () => {
              URL.revokeObjectURL(audioUrl);
              resolve();
            };
          });

          if (speakCancelRef.current) break;
          currentBlob = await nextBlobPromise;
        }

        setIsSpeaking(false);
        audioElementRef.current = null;
      };

      await playLoop(firstBlob);
    } catch (err) {
      setIsSpeaking(false);
      audioElementRef.current = null;
      setError(err instanceof Error ? err.message : 'Failed to speak response');
    }
  };

  const stopAudio = () => {
    console.log('Frontend: Stopping audio playback');
    speakCancelRef.current = true;
    try {
      ttsCancelPrefetchRef.current && ttsCancelPrefetchRef.current();
    } catch {}
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
      audioElementRef.current = null;
    }
    setIsSpeaking(false);
  };

  const streamAnswerWithParallelTts = (fullAnswer: string, originalQuestion?: string) => {
    // Reset streaming/TTS state
    setResponse('');
    setDisplayResponse('');
    ttsStartedRef.current = false;
    ttsCursorRef.current = 0;
    streamingDoneRef.current = false;
    speakCancelRef.current = false;

    // Prepare TTS parts up-front from the full answer
    const ttsParts = partitionAnswerForTts(fullAnswer);

    // Kick off TTS streamer loop for these parts, capture audio to cache if needed
    const ttsCapturedParts: CachedTtsPart[] = [];
    startTtsStreamerWithParts(ttsParts, (part) => {
      ttsCapturedParts.push(part);
    }, () => {
      // First audio is ready → reveal full text alongside audio
      setDisplayResponse(fullAnswer);
    }).finally(() => {
      if (originalQuestion) {
        trySaveToQaCache(originalQuestion, fullAnswer, ttsCapturedParts);
      }
    });

    // Stream words into the UI like ChatGPT
    const words = fullAnswer.split(/\s+/).filter(Boolean);
    let i = 0;

    const pump = () => {
      if (i >= words.length) {
        streamingDoneRef.current = true;
        return;
      }
      // Append next word
      setResponse(prev => (prev ? prev + ' ' + words[i] : words[i]));
      i += 1;

      // Allow TTS to begin immediately; streamer will play as soon as part 1 is fetched
      if (!ttsStartedRef.current) ttsStartedRef.current = true;

      // Adjust delay for a natural feel
      const delay = words[i - 1].length > 6 ? 30 : 18;
      setTimeout(pump, delay);
    };

    pump();
  };

  const startTtsStreamerWithParts = (
    parts: string[],
    onPartFetched?: (part: CachedTtsPart) => void,
    onFirstReady?: () => void
  ): Promise<void> => {
    // Runs in background, speaking provided parts while prefetching next
    return (async () => {
      try {
        if (speakCancelRef.current) return;
        console.log('TTS streamer: starting with parts count =', parts.length);
        setIsSpeaking(true);
        // Prefetcher for provided parts
        const prefetcher = createTtsPrefetcher(parts, onPartFetched);
        ttsCancelPrefetchRef.current = prefetcher.cancel;

        // Fetch first audio
        let currentBlob = await prefetcher.next();
        if (speakCancelRef.current) return;
        if (!currentBlob) {
          console.warn('TTS streamer: first blob missing');
        } else {
          try { onFirstReady && onFirstReady(); } catch {}
        }

        while (currentBlob && !speakCancelRef.current) {
          const nextBlobPromise = prefetcher.next();
          await playAudioBlob(currentBlob);
          if (speakCancelRef.current) break;
          currentBlob = await nextBlobPromise;
        }
      } finally {
        setIsSpeaking(false);
        audioElementRef.current = null;
      }
    })();
  };

  const partitionAnswerForTts = (fullText: string): string[] => {
    const text = fullText.replace(/\s+/g, ' ').trim();
    if (!text) return [];

    // Token-like split by words; create 100-word blocks for TTS
    const words = text.split(/\s+/).filter(Boolean);
    const maxWordsPerPart = 100;
    if (words.length <= maxWordsPerPart) return [text];

    const parts: string[] = [];
    for (let i = 0; i < words.length; i += maxWordsPerPart) {
      parts.push(words.slice(i, i + maxWordsPerPart).join(' '));
    }

    return parts;
  };

  const deriveNaturalLines = (text: string): string[] => {
    // Prefer explicit newlines if present
    const hasNewlines = /\n/.test(text);
    if (hasNewlines) {
      const byNewline = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
      if (byNewline.length >= 2) return byNewline;
    }

    // Fallback: sentence-aware grouping into visual "lines" around ~120 chars
    const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    if (sentences.length <= 2) return [text];

    const targetLen = 120; // approximate visual line length
    const lines: string[] = [];
    let buf = '';
    for (const s of sentences) {
      const candidate = buf ? buf + ' ' + s : s;
      if (candidate.length <= targetLen || !buf) {
        buf = candidate;
      } else {
        lines.push(buf);
        buf = s;
      }
    }
    if (buf) lines.push(buf);

    // Cap to at most 6 lines for coherence
    if (lines.length > 6) {
      const merged: string[] = [];
      let acc = '';
      for (const l of lines) {
        const c = acc ? acc + ' ' + l : l;
        if (c.length <= targetLen * 1.2) acc = c; else { merged.push(acc); acc = l; }
      }
      if (acc) merged.push(acc);
      return merged;
    }
    return lines;
  };

  const playAudioBlob = async (blob: Blob) => {
    return new Promise<void>((resolve) => {
      const audioUrl = URL.createObjectURL(blob);
      const audioElement = new Audio(audioUrl);
      audioElementRef.current = audioElement;
      audioElement.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      audioElement.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      const p = audioElement.play();
      p.catch(() => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      });
    });
  };

  const base64ToBlob = (base64: string, mimeType: string) => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  };

  const createTtsPrefetcher = (chunks: string[], onPartFetched?: (part: CachedTtsPart) => void) => {
    let cancelled = false;
    let index = 0;
    const queue: Blob[] = [];
    const waiters: Array<(b: Blob | null) => void> = [];

    const fetchSequentially = async () => {
      while (!cancelled && index < chunks.length) {
        try {
          const part = await fetchTtsForCaching(chunks[index]);
          if (cancelled) return;
          onPartFetched && onPartFetched({ audio: part.audioBase64, mimeType: part.mimeType, originalMimeType: part.originalMimeType });
          queue.push(part.blob);
          index += 1;
          if (waiters.length > 0) {
            const resolve = waiters.shift();
            resolve && resolve(queue.shift() || null);
          }
        } catch (e) {
          if (cancelled) return;
          // On fetch error, push a brief silence blob and continue to next chunk
          try {
            const silence = createSilenceBlob(200);
            queue.push(silence);
            index += 1;
            if (waiters.length > 0) {
              const resolve = waiters.shift();
              resolve && resolve(queue.shift() || null);
            }
          } catch (_) {
            // If even silence creation fails, skip forward
            index += 1;
          }
        }
      }
      // No more chunks; satisfy any remaining waiters with null
      while (waiters.length > 0) {
        const resolve = waiters.shift();
        resolve && resolve(null);
      }
    };

    // kick off
    fetchSequentially();

    return {
      cancel: () => {
        cancelled = true;
      },
      next: (): Promise<Blob | null> => {
        if (queue.length > 0) {
          return Promise.resolve(queue.shift() as Blob);
        }
        return new Promise((resolve) => {
          waiters.push(resolve);
        });
      }
    };
  };

  const createSilenceBlob = (durationMs: number = 200): Blob => {
    const sampleRate = 24000;
    const samples = Math.max(1, Math.floor((durationMs / 1000) * sampleRate));
    const pcm = new Uint8Array(samples * 2); // 16-bit mono zeros
    return pcmToWav(pcm, sampleRate);
  };

  const pcmToWav = (pcmData: Uint8Array, sampleRate: number = 24000, numChannels: number = 1, bitsPerSample: number = 16): Blob => {
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    // RIFF identifier
    view.setUint32(0, 0x52494646, false); // "RIFF"
    // file length
    view.setUint32(4, 36 + pcmData.length, true);
    // RIFF type & Format
    view.setUint32(8, 0x57415645, false); // "WAVE"
    view.setUint32(12, 0x666D7420, false); // "fmt "
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (PCM)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, numChannels, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate
    view.setUint32(28, byteRate, true);
    // block align
    view.setUint16(32, blockAlign, true);
    // bits per sample
    view.setUint16(34, bitsPerSample, true);
    // data chunk identifier
    view.setUint32(36, 0x64617461, false); // "data"
    // data chunk length
    view.setUint32(40, pcmData.length, true);

    // Create a new array to avoid type issues
    const headerArray = new Uint8Array(wavHeader);
    const combinedArray = new Uint8Array(headerArray.length + pcmData.length);
    combinedArray.set(headerArray, 0);
    combinedArray.set(pcmData, headerArray.length);
    return new Blob([combinedArray], { type: 'audio/wav' });
  };

  const fetchTtsBlob = async (textChunk: string): Promise<Blob> => {
    const maxAttempts = 4;
    let attempt = 0;
    let lastErr: any = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        // Respect global cooldown if set due to prior 429
        const now = Date.now();
        const waitUntil = ttsCooldownUntilRef.current || 0;
        if (now < waitUntil) {
          await new Promise(r => setTimeout(r, waitUntil - now));
        }
        const ttsResponse = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: textChunk })
        });

        if (!ttsResponse.ok) {
          const errJson = await ttsResponse.json().catch(() => ({} as any));
          // Handle 429 backoff using server-provided retryAfterMs when available
          if (ttsResponse.status === 429) {
            const waitMs = typeof errJson?.retryAfterMs === 'number' ? errJson.retryAfterMs : 6000 * attempt;
            ttsCooldownUntilRef.current = Date.now() + waitMs;
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          throw new Error(errJson?.error || `Failed to generate speech (status ${ttsResponse.status})`);
        }

        const { audio, mimeType, originalMimeType } = await ttsResponse.json();
        if (originalMimeType && (originalMimeType.includes('L16') || originalMimeType.includes('pcm'))) {
          const byteCharacters = atob(audio);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const pcmArray = new Uint8Array(byteNumbers);
          return pcmToWav(pcmArray, 24000);
        }
        return base64ToBlob(audio, mimeType);
      } catch (e) {
        lastErr = e;
        // small jittered backoff for transient failures
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      }
    }
    throw (lastErr instanceof Error ? lastErr : new Error('TTS failed after retries'));
  };

  const fetchTtsForCaching = async (textChunk: string): Promise<{ blob: Blob; audioBase64: string; mimeType: string; originalMimeType?: string }> => {
    const ttsResponse = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textChunk })
    });
    if (!ttsResponse.ok) {
      const errorData = await ttsResponse.json().catch(() => ({}));
      throw new Error((errorData as any).error || 'Failed to generate speech');
    }
    const { audio, mimeType, originalMimeType } = await ttsResponse.json();
    let blob: Blob;
    if (originalMimeType && (originalMimeType.includes('L16') || originalMimeType.includes('pcm'))) {
      const byteCharacters = atob(audio);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      const pcmArray = new Uint8Array(byteNumbers);
      blob = pcmToWav(pcmArray, 24000);
    } else {
      blob = base64ToBlob(audio, mimeType);
    }
    return { blob, audioBase64: audio, mimeType, originalMimeType };
  };

  const normalizeQuestion = (q: string) => {
    return q
      .normalize('NFKC')
      .replace(/[\u0964\u0965\u0A83\u0ABD\u0AE0\u0AE1\u0AF0\u0AF1]/g, ' ')
      .replace(/[\u0A80-\u0AFF]/g, (ch) => ch)
      .replace(/[\p{P}\p{S}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };
  const QA_CACHE_KEY = 'vachanamrut_qa_cache_v1';
  const QA_CACHE_LIMIT = 20;

  const getFromQaCache = (question: string): QaCacheEntry | null => {
    try {
      const raw = localStorage.getItem(QA_CACHE_KEY);
      if (!raw) return null;
      const arr: QaCacheEntry[] = JSON.parse(raw);
      const key = normalizeQuestion(question);
      return arr.find(e => normalizeQuestion(e.question) === key) || null;
    } catch {
      return null;
    }
  };

  const trySaveToQaCache = (question: string, answer: string, ttsParts: CachedTtsPart[], append: boolean = true) => {
    try {
      const entry: QaCacheEntry = { question, answer, ttsParts };
      const raw = localStorage.getItem(QA_CACHE_KEY);
      let arr: QaCacheEntry[] = [];
      if (raw) {
        arr = JSON.parse(raw);
        const key = normalizeQuestion(question);
        const idx = arr.findIndex(e => normalizeQuestion(e.question) === key);
        if (idx >= 0) {
          if (append && ttsParts && ttsParts.length > 0) {
            const existing = arr[idx];
            existing.answer = answer || existing.answer;
            existing.ttsParts = [...(existing.ttsParts || []), ...ttsParts];
            arr.splice(idx, 1);
            arr.unshift(existing);
            localStorage.setItem(QA_CACHE_KEY, JSON.stringify(arr.slice(0, QA_CACHE_LIMIT)));
            return;
          } else {
            arr.splice(idx, 1);
          }
        }
      }
      arr.unshift(entry);
      if (arr.length > QA_CACHE_LIMIT) arr = arr.slice(0, QA_CACHE_LIMIT);
      localStorage.setItem(QA_CACHE_KEY, JSON.stringify(arr));
    } catch {
      // ignore cache write errors
    }
  };

  const speakFromCachedParts = async (parts: CachedTtsPart[]) => {
    setIsSpeaking(true);
    speakCancelRef.current = false;
    try {
      for (let i = 0; i < parts.length && !speakCancelRef.current; i++) {
        const p = parts[i];
        let blob: Blob;
        if (p.originalMimeType && (p.originalMimeType.includes('L16') || p.originalMimeType.includes('pcm'))) {
          const byteCharacters = atob(p.audio);
          const byteNumbers = new Array(byteCharacters.length);
          for (let j = 0; j < byteCharacters.length; j++) byteNumbers[j] = byteCharacters.charCodeAt(j);
          const pcmArray = new Uint8Array(byteNumbers);
          blob = pcmToWav(pcmArray, 24000);
        } else {
          blob = base64ToBlob(p.audio, p.mimeType);
        }
        await playAudioBlob(blob);
      }
    } finally {
      setIsSpeaking(false);
      audioElementRef.current = null;
    }
  };

  const chunkTextForTts = (fullText: string, targetChunkSize: number): string[] => {
    const text = fullText.replace(/\s+/g, ' ').trim();
    if (!text) return [];

    // 1) Split into sentences
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);

    const chunks: string[] = [];

    const pushSmart = (piece: string) => {
      const trimmed = piece.trim();
      if (!trimmed) return;
      if (trimmed.length <= targetChunkSize) {
        chunks.push(trimmed);
        return;
      }
      // 3) If clause still too long, split by words to enforce hard cap
      const words = trimmed.split(/\s+/);
      let buf = '';
      for (const w of words) {
        const candidate = buf ? buf + ' ' + w : w;
        if (candidate.length <= targetChunkSize) {
          buf = candidate;
        } else {
          if (buf) chunks.push(buf);
          buf = w;
        }
      }
      if (buf) chunks.push(buf);
    };

    for (const sentence of sentences) {
      if (sentence.length <= targetChunkSize) {
        chunks.push(sentence);
        continue;
      }
      // 2) Further split long sentences into clauses by commas/semicolons
      const clauses = sentence.split(/[,;]+\s*/).filter(Boolean);
      let current = '';
      for (const clause of clauses) {
        const candidate = current ? current + ', ' + clause : clause;
        if (candidate.length <= targetChunkSize) {
          current = candidate;
        } else {
          if (current) pushSmart(current);
          pushSmart(clause);
          current = '';
        }
      }
      if (current) pushSmart(current);
    }

    // Fallback for text without punctuation at all
    if (chunks.length === 0) {
      let i = 0;
      while (i < text.length) {
        chunks.push(text.slice(i, i + targetChunkSize));
        i += targetChunkSize;
      }
    }

    return chunks;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-blue-50">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <header className="text-center mb-12">
          <h1 className="text-5xl font-bold text-orange-700 mb-3">
            🕉️ વચનામૃત સાથી
          </h1>
          <h2 className="text-2xl text-blue-700 mb-2">Vachanamrut Companion</h2>
          <p className="text-gray-600">
            Ask questions about Vachanamrut teachings in English or Gujarati
          </p>
        </header>

        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8 mb-6">
          {/* Microphone Button */}
          <div className="flex justify-center items-center gap-4 mb-8">
            <button
              onClick={isListening ? stopListening : startListening}
              disabled={isProcessing || isSpeaking}
              className={`relative w-32 h-32 rounded-full transition-all duration-300 transform hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed ${
                isListening
                  ? 'bg-red-500 animate-pulse shadow-lg shadow-red-500/50'
                  : 'bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg'
              }`}
            >
              <div className="flex items-center justify-center">
                {isListening ? (
                  <svg className="w-16 h-16 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-16 h-16 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            </button>

            {/* Stop Audio Button */}
            {isSpeaking && (
              <button
                onClick={stopAudio}
                className="relative w-20 h-20 rounded-full bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 shadow-lg transition-all duration-300 transform hover:scale-110 animate-fade-in"
              >
                <div className="flex items-center justify-center">
                  <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                  </svg>
                </div>
              </button>
            )}
          </div>

          {/* Status Text */}
          <div className="text-center mb-6">
            {isListening && (
              <p className="text-red-600 font-semibold text-lg animate-pulse">
                🎤 Listening... Speak now
              </p>
            )}
            {isProcessing && (
              <p className="text-blue-600 font-semibold text-lg">
                🤔 Searching the Vachanamrut...
              </p>
            )}
            {isSpeaking && (
              <p className="text-green-600 font-semibold text-lg">
                🔊 Speaking...
              </p>
            )}
            {!isListening && !isProcessing && !isSpeaking && (
              <p className="text-gray-500 text-lg">
                Tap the microphone to ask a question
              </p>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded">
              <p className="text-red-700">{error}</p>
            </div>
          )}

          {/* Current Conversation */}
          {(transcript || displayResponse) && (
            <div className="space-y-4 mb-6">
              {transcript && (
                <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500">
                  <p className="text-sm text-blue-600 font-semibold mb-1">Your Question:</p>
                  <p className="text-gray-800">{transcript}</p>
                </div>
              )}
              {displayResponse && (
                <div className="bg-orange-50 p-4 rounded-lg border-l-4 border-orange-500">
                  <p className="text-sm text-orange-600 font-semibold mb-1">Answer:</p>
                  <p className="text-gray-800 whitespace-pre-wrap">{displayResponse}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat History */}
        {history.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h3 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
              📜 History
            </h3>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {history.map((item, index) => (
                <div key={index} className="border-b border-gray-200 pb-4 last:border-b-0">
                  <div className="mb-2">
                    <p className="text-sm text-blue-600 font-semibold">Question {index + 1}:</p>
                    <p className="text-gray-700">{item.query}</p>
                  </div>
                  <div>
                    <p className="text-sm text-orange-600 font-semibold">Answer:</p>
                    <p className="text-gray-700 text-sm whitespace-pre-wrap">{item.answer}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="text-center mt-8 text-gray-500 text-sm">
          <p>Powered by Google Gemini AI • Supporting English and Gujarati</p>
      </footer>
      </div>
    </div>
  );
}

