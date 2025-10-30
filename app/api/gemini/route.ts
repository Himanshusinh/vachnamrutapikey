import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();
    
    console.log('Received query:', query);
    
    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY || 'AIzaSyBoWP3Wz8Y6nRdBbemTFV8shJ3DqEYpsQM';
    
    console.log('API Key exists:', !!apiKey);
    console.log('API Key length:', apiKey?.length);
    
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
    }

    // Call Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`,
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
                  text: `You are a knowledgeable assistant specializing ONLY in the Vachanamrut, a sacred Hindu scripture containing the teachings of Bhagwan Swaminarayan.

The Vachanamrut is a collection of 273 spiritual discourses given by Bhagwan Swaminarayan between 1819 and 1829. It covers topics like dharma, bhakti, moksha, the nature of God, and spiritual practices.

CRITICAL INSTRUCTIONS:
1. ONLY answer questions that are directly related to the Vachanamrut scripture, its teachings, Bhagwan Swaminarayan, or topics covered in the Vachanamrut.

2. If a question is NOT about the Vachanamrut, you MUST politely decline and redirect. Use responses like:
   - In English: "I apologize, but I can only answer questions about the Vachanamrut scripture. Please ask me about the teachings of Bhagwan Swaminarayan or topics from the Vachanamrut."
   - In Gujarati: "માફ કરશો, પરંતુ હું ફક્ત વચનામૃત વિશેના પ્રશ્નોના જવાબ આપી શકું છું. કૃપા કરીને મને ભગવાન સ્વામિનારાયણના ઉપદેશો અથવા વચનામૃતમાંથી પ્રશ્નો પૂછો."

3. Topics that ARE acceptable: Vachanamrut content, Bhagwan Swaminarayan's life and teachings, dharma, bhakti, moksha, spiritual practices mentioned in Vachanamrut, satsang, and related spiritual concepts.

4. Topics that are NOT acceptable: General knowledge, current events, other religious texts, science, technology, entertainment, or anything not related to Vachanamrut.

5. Language matching:
   - If the question is in English, respond in English
   - If the question is in Gujarati, respond in Gujarati

6. Be respectful and reverent when discussing the Vachanamrut teachings.

Question: ${query}`
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            candidateCount: 1,
          }
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Gemini API error status:', response.status);
      console.error('Gemini API error details:', error);
      return NextResponse.json(
        { error: `Gemini API error: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';

    return NextResponse.json({ answer });
  } catch (error) {
    console.error('Error in Gemini API route:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error details:', errorMessage);
    return NextResponse.json(
      { error: `Internal server error: ${errorMessage}` },
      { status: 500 }
    );
  }
}

