// Mints a short-lived WebRTC token for the Recall voice agent.
// WebRTC is ElevenLabs' current browser default for voice conversations and
// keeps audio transport off the application request path.
export async function GET() {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    if (!apiKey || !agentId) {
      return Response.json(
        { error: "ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID not configured" },
        { status: 503 },
      );
    }

    const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/token");
    url.searchParams.set("agent_id", agentId);
    const response = await fetch(url, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return Response.json(
        { error: `elevenlabs ${response.status}: ${await response.text()}` },
        { status: 502 },
      );
    }
    const data = (await response.json()) as { token?: unknown };
    if (typeof data.token !== "string" || !data.token) {
      return Response.json({ error: "ElevenLabs returned no WebRTC token" }, { status: 502 });
    }
    return Response.json({ conversationToken: data.token, connectionType: "webrtc" });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "couldn't reach ElevenLabs" },
      { status: 502 },
    );
  }
}
