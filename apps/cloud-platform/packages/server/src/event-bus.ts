import type { LotaruEvent } from "./events.js";

export type LotaruEventPartial = {
  type: string;
  projectId: string;
  scriptId: string;
  path: string;
  detail: string;
};

export type LotaruEmitKind = "live" | "replay";

export type LotaruEventPublisher = (
  partial: LotaruEventPartial,
  emitKind: LotaruEmitKind,
) => LotaruEvent;

let activePublisher: LotaruEventPublisher | false = false;

export function setLotaruEventPublisher(publisher: LotaruEventPublisher): void {
  activePublisher = publisher;
}

export function publishLotaruEvent(
  partial: LotaruEventPartial,
  emitKind: LotaruEmitKind,
): LotaruEvent {
  if (activePublisher === false) {
    throw new Error("Lotaru event publisher is not registered");
  }
  return activePublisher(partial, emitKind);
}

export function tryPublishLotaruEvent(
  partial: LotaruEventPartial,
  emitKind: LotaruEmitKind,
): LotaruEvent | false {
  if (activePublisher === false) {
    return false;
  }
  return activePublisher(partial, emitKind);
}
