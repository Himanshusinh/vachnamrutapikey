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
  const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Array<{ query: string; answer: string }>>([]);
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // Check if backend URL is configured
  useEffect(() => {
    if (!API_BASE) {
      setError('Backend server not configured. Please set NEXT_PUBLIC_BACKEND_URL environment variable.');
    }
  }, [API_BASE]);

  const processQuery = useCallback(async (query: string) => {
    if (!API_BASE) {
      setError('Backend server URL not configured. Please set NEXT_PUBLIC_BACKEND_URL in your .env.local file.');
      return;
    }

    setIsProcessing(true);
    setError('');

    try {
      // Get answer from backend (backend will check history first)
      const geminiResponse = await fetch(`${API_BASE}/api/gemini`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!geminiResponse.ok) {
        throw new Error('Failed to get response from AI');
      }

      const { answer, fromCache, ttsParts } = await geminiResponse.json();
      setResponse(answer);

      // Add to history
      setHistory(prev => [...prev, { query, answer }]);

      // If we have cached audio parts, use them directly (no API call needed)
      if (fromCache && ttsParts && ttsParts.length > 0) {
        console.log('Using cached audio - no TTS API call needed');
        await speakFromCachedAudio(ttsParts);
      } else {
        // New question - generate TTS and save to history
        console.log('New question - generating TTS...');
        await speakResponse(answer, query);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsProcessing(false);
    }
  }, [API_BASE]);

  useEffect(() => {
    // Initialize Speech Recognition
    if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      const SpeechRecognition = (window as SpeechRecognitionWindow).SpeechRecognition || (window as SpeechRecognitionWindow).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'gu-IN'; // Gujarati + English (India)

      recognitionRef.current.onresult = async (event: SpeechRecognitionEvent) => {
        const speechToText = event.results[0][0].transcript;
        setTranscript(speechToText);
        setIsListening(false);
        
        // Automatically process the query
        await processQuery(speechToText);
      };

      recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error);
        setError(`Voice recognition error: ${event.error}`);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [processQuery]);

  const startListening = () => {
    if (recognitionRef.current) {
      setError('');
      setTranscript('');
      setResponse('');
      setIsListening(true);
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
  };

  // Play audio from cached parts (no API call)
  const speakFromCachedAudio = async (ttsParts: Array<{ audio: string; mimeType: string; originalMimeType?: string }>) => {
    console.log('Frontend: Using cached audio - no TTS API call needed');
    setIsSpeaking(true);

    try {
      for (let i = 0; i < ttsParts.length; i++) {
        const part = ttsParts[i];
        let audioBlob: Blob;
        
        if (part.originalMimeType && (part.originalMimeType.includes('L16') || part.originalMimeType.includes('pcm'))) {
          console.log(`Frontend: Converting cached PCM part ${i} to WAV...`);
          const byteCharacters = atob(part.audio);
          const byteNumbers = new Array(byteCharacters.length);
          for (let j = 0; j < byteCharacters.length; j++) {
            byteNumbers[j] = byteCharacters.charCodeAt(j);
          }
          const pcmArray = new Uint8Array(byteNumbers);
          audioBlob = pcmToWav(pcmArray, 24000);
        } else {
          audioBlob = base64ToBlob(part.audio, part.mimeType);
        }
        
        const audioUrl = URL.createObjectURL(audioBlob);
        const audioElement = new Audio(audioUrl);
        audioElementRef.current = audioElement;

        await new Promise<void>((resolve) => {
          audioElement.onended = () => {
            URL.revokeObjectURL(audioUrl);
            resolve();
          };
          audioElement.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            resolve();
          };
          audioElement.play().catch(() => resolve());
        });
      }
      setIsSpeaking(false);
      audioElementRef.current = null;
    } catch (err) {
      setIsSpeaking(false);
      audioElementRef.current = null;
      setError(err instanceof Error ? err.message : 'Failed to play cached audio');
    }
  };

  // Generate new TTS and save to history
  const speakResponse = async (text: string, question?: string) => {
    if (!API_BASE) {
      setError('Backend server URL not configured.');
      return;
    }

    console.log('Frontend: Starting TTS for text:', text.substring(0, 50) + '...');
    setIsSpeaking(true);

    const sessionTimestamp = Date.now();

    try {
      // Get audio from TTS API via backend
      const ttsResponse = await fetch(`${API_BASE}/api/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      console.log('Frontend: TTS response status:', ttsResponse.status);

      if (!ttsResponse.ok) {
        const errorData = await ttsResponse.json();
        console.error('Frontend: TTS error:', errorData);
        throw new Error(errorData.error || 'Failed to generate speech');
      }

      const { audio, mimeType, originalMimeType } = await ttsResponse.json();
      console.log('Frontend: Received audio, mimeType:', mimeType, 'original:', originalMimeType);

      // Convert base64 to audio and play
      let audioBlob;
      
      if (originalMimeType && (originalMimeType.includes('L16') || originalMimeType.includes('pcm'))) {
        console.log('Frontend: Converting PCM to WAV...');
        const byteCharacters = atob(audio);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const pcmArray = new Uint8Array(byteNumbers);
        audioBlob = pcmToWav(pcmArray, 24000);
        console.log('Frontend: Created WAV blob from PCM, size:', audioBlob.size);
      } else {
        audioBlob = base64ToBlob(audio, mimeType);
        console.log('Frontend: Created audio blob, size:', audioBlob.size);
      }
      
      // Save audio to history in background
      if (question) {
        fetch(`${API_BASE}/api/history/save-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: audio,
            mimeType,
            originalMimeType,
            question,
            answer: text,
            index: 0,
            timestamp: sessionTimestamp
          })
        }).catch(err => console.error('Failed to save audio to history:', err));
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      const audioElement = new Audio(audioUrl);
      audioElementRef.current = audioElement;

      audioElement.onended = () => {
        console.log('Frontend: Audio playback ended');
        setIsSpeaking(false);
        audioElementRef.current = null;
        URL.revokeObjectURL(audioUrl);
      };

      audioElement.onerror = (e) => {
        console.error('Frontend: Audio playback error:', e);
        setIsSpeaking(false);
        audioElementRef.current = null;
        setError('Failed to play audio');
        URL.revokeObjectURL(audioUrl);
      };

      console.log('Frontend: Starting audio playback...');
      await audioElement.play();
      console.log('Frontend: Audio is playing');
    } catch (err) {
      setIsSpeaking(false);
      audioElementRef.current = null;
      setError(err instanceof Error ? err.message : 'Failed to speak response');
    }
  };

  const stopAudio = () => {
    console.log('Frontend: Stopping audio playback');
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
      audioElementRef.current = null;
    }
    setIsSpeaking(false);
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
          {(transcript || response) && (
            <div className="space-y-4 mb-6">
              {transcript && (
                <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500">
                  <p className="text-sm text-blue-600 font-semibold mb-1">Your Question:</p>
                  <p className="text-gray-800">{transcript}</p>
                </div>
              )}
              {response && (
                <div className="bg-orange-50 p-4 rounded-lg border-l-4 border-orange-500">
                  <p className="text-sm text-orange-600 font-semibold mb-1">Answer:</p>
                  <p className="text-gray-800 whitespace-pre-wrap">{response}</p>
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
