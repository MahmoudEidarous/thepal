import {
  CaptureEvidencePayloadSchema,
  CaptureRequestSchema,
  MemoryEventSchema,
  MemoryReceiptSchema,
  type CaptureRequest,
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
  constructor(private readonly ledger: MemoryEventLedger = getMemoryEventLedger()) {}

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
    });

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
}

export function captureEvidence(input: CaptureRequest): CapturedEvidence {
  return new MemoryWriteBroker().capture(input);
}
