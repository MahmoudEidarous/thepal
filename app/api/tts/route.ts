// Voice for dream briefings — ElevenLabs TTS, streamed back as audio.
export async function POST(request: Request) {
  try {
    const { text } = await request.json().catch(() => ({}));
    if (typeof text !== "string" || !text.trim()) {
      return Response.json({ error: "text required" }, { status: 400 });
    }
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "ELEVENLABS_API_KEY is not set" }, { status: 503 });
    }
    const res = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=mp3_44100_128",
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text.slice(0, 2500),
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.45, similarity_boost: 0.7 },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      return Response.json(
        { error: `elevenlabs ${res.status}: ${await res.text()}` },
        { status: 502 },
      );
    }
    return new Response(res.body, { headers: { "Content-Type": "audio/mpeg" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "tts failed" },
      { status: 502 },
    );
  }
}
