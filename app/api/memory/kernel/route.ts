import {
  CONTINUITY_KERNEL_HARD_MAX_TOKENS,
  materializeContinuityKernel,
} from "@/lib/memory/continuity-kernel";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const result = materializeContinuityKernel({
      space,
      force: url.searchParams.get("refresh") === "true",
    });
    return Response.json(
      {
        ...result,
        agentText: result.kernel.compiledText,
        limits: {
          hardMaxTokens: CONTINUITY_KERNEL_HARD_MAX_TOKENS,
          localOnly: true,
          startupLlmCalls: 0,
          startupSupermemoryCalls: 0,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = materializeContinuityKernel({
      space: asSpace(body.space),
      force: true,
      targetTokens:
        typeof body.targetTokens === "number" ? Math.floor(body.targetTokens) : undefined,
    });
    return Response.json({ ...result, agentText: result.kernel.compiledText });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const ledger = getMemoryEventLedger();
    ledger.invalidateContinuityKernel("local-user", space);
    return Response.json({ invalidated: true, space });
  } catch (error) {
    return apiError(error);
  }
}
