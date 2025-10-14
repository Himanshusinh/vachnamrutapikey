import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();
    
    console.log('TTS: Received text:', text.substring(0, 50) + '...');
    
    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY || 'AIzaSyBOVBcNEavJgEygVB78WGJO1xHIDyxFh3M';
    
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
    }

    // Call Gemini TTS API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: text
                }
              ]
            }
          ],
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
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('TTS: API error status:', response.status);
      console.error('TTS: API error details:', error);
      return NextResponse.json(
        { error: `Failed to generate speech: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('TTS: Response structure:', JSON.stringify(data, null, 2));
    
    const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;

    if (!audioData) {
      console.error('TTS: No audio data in response');
      console.error('TTS: Full response:', JSON.stringify(data, null, 2));
      return NextResponse.json(
        { error: 'No audio data generated' },
        { status: 500 }
      );
    }
    
    console.log('TTS: Audio data found, mimeType:', audioData.mimeType);

    // Convert PCM to WAV if needed
    let finalAudio = audioData.data;
    let finalMimeType = audioData.mimeType;

    if (audioData.mimeType.includes('L16') || audioData.mimeType.includes('pcm')) {
      console.log('TTS: Converting PCM to WAV...');
      // The audio is PCM, we'll send it as-is and convert on client side
      finalMimeType = 'audio/wav';
    }

    return NextResponse.json({ 
      audio: finalAudio,
      mimeType: finalMimeType,
      originalMimeType: audioData.mimeType
    });
  } catch (error) {
    console.error('Error in TTS API route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

