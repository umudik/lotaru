import type { LotaruEvent } from "./events.js";
import { parseLotaruPublish, type LotaruPublishInput, type StoredEventFields } from "./event-publish.js";

export type LotaruEventPartial = StoredEventFields;

export type LotaruEmitKind = "live" | "replay";

export type LotaruEventPublisher = (
  input: LotaruPublishInput,
  emitKind: LotaruEmitKind,
  agentChain: readonly string[],
) => LotaruEvent;

type PublisherSlot = {
  publisher: LotaruEventPublisher;
};

let publisherSlots: PublisherSlot[] = [];

export function setLotaruEventPublisher(publisher: LotaruEventPublisher): void {
  publisherSlots = [{ publisher }];
}

export function clearLotaruEventPublisher(): void {
  publisherSlots = [];
}

export function publishLotaruEvent(
  input: LotaruPublishInput,
  emitKind: LotaruEmitKind,
): LotaruEvent {
  const parsed = parseLotaruPublish(input);
  const agentChain: readonly string[] = [];
  for (const slot of publisherSlots) {
    return slot.publisher(parsed, emitKind, agentChain);
  }
  throw new Error("Lotaru event publisher is not registered");
}

export type { LotaruPublishInput, StoredEventFields };
