import {
  CaptureEvidencePayloadSchema,
  CaptureRequestSchema,
  CorrectionRequestSchema,
  MemoryEventSchema,
  MemoryReceiptSchema,
  type CaptureRequest,
  type CorrectionRequest,
  type MemoryEvent,
  type MemoryReceipt,
} from "./contracts";
import { getMemoryEventLedger, type MemoryEventLedger } from "./event-ledger";
import { redactSecrets } from "./redaction";
import { classifyCaptureSource } from "./source-policy";

export type CapturedEvidence = {
  event: MemoryEvent;
  receipt: MemoryReceipt;
  safeContent: string;
  preRedacted: boolean;
};

export class MemoryWriteBroker {
  constructor(
    private readonly ledger: MemoryEventLedger = getMemoryEventLedger(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private validated(appended: ReturnType<MemoryEventLedger["appendEvent"]>): CapturedEvidence {
    // Read-back validation turns a corrupt or incompatible write into a hard
    // failure before the route acknowledges it as durable.
    const event = MemoryEventSchema.parse(appended.event);
    const receipt = MemoryReceiptSchema.parse(appended.receipt);
    return {
      event,
      receipt,
      safeContent: event.payload.content,
      preRedacted: event.payload.redacted,
    };
  }

  capture(input: unknown): CapturedEvidence {
    const request = CaptureRequestSchema.parse(input);
    const { text: safeContent, redacted } = redactSecrets(request.content);
    const classification = classifyCaptureSource(request.source);
    const payload = CaptureEvidencePayloadSchema.parse({
      content: safeContent,
      redacted,
      legacySource: request.source,
      requested: {
        kind: request.kind,
        due: request.due ?? null,
      },
    });
    const appended = this.ledger.appendEvent({
      userId: request.userId,
      space: request.space,
      kind: classification.eventKind,
      payload,
      source: classification.source,
      sensitivity: redacted ? "sensitive" : "normal",
      idempotencyKey: request.idempotencyKey,
      recordedAt: this.now(),
    });

    return this.validated(appended);
  }

  correct(input: unknown): CapturedEvidence {
    const request = CorrectionRequestSchema.parse(input);
    const target = this.ledger.getEvent(request.targetEventId);
    if (!target || target.tombstonedAt) {
      throw new Error(`correction target ${request.targetEventId} is unavailable`);
    }
    if (target.userId !== request.userId) {
      throw new Error("a correction cannot cross users");
    }
    const { text: safeContent, redacted } = redactSecrets(request.content);
    const payload = CaptureEvidencePayloadSchema.parse({
      content: safeContent,
      redacted,
      legacySource: request.source,
      requested: {
        kind: target.payload.requested.kind,
        due: target.payload.requested.due,
      },
    });
    return this.validated(
      this.ledger.appendEvent({
        userId: request.userId,
        space: target.space,
        kind: "correction",
        payload,
        source: {
          actor: "user",
          channel: request.source.toLowerCase().includes("voice") ? "voice" : "text",
          trust: "user_direct",
          label: request.source,
        },
        sensitivity: redacted ? "sensitive" : "normal",
        revisionOf: target.id,
        idempotencyKey: request.idempotencyKey,
        recordedAt: this.now(),
      }),
    );
  }
}

export function captureEvidence(input: CaptureRequest): CapturedEvidence {
  return new MemoryWriteBroker().capture(input);
}

export function correctEvidence(input: CorrectionRequest): CapturedEvidence {
  return new MemoryWriteBroker().correct(input);
}
