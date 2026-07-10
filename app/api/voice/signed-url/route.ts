// Mints a short-lived signed WebSocket URL for the Recall voice agent.
// The xi-api-key stays server-side; the browser only ever sees the URL.
export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) {
    return Response.json(
      { error: "ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID not configured" },
      { status: 503 },
    );
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
    { headers: { "xi-api-key": apiKey } },
  );
  if (!res.ok) {
    return Response.json({ error: `elevenlabs ${res.status}: ${await res.text()}` }, { status: 502 });
  }
  const data = await res.json();
  return Response.json({ signedUrl: data.signed_url });
}
