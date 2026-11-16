export type MiniDragCancelReason = "pointercancel" | "lostpointercapture" | "remove";

export interface MiniDragCancellation {
  active: false;
  notify: boolean;
}

export function miniDragCancellation(
  active: boolean,
  reason: MiniDragCancelReason,
): MiniDragCancellation {
  switch (reason) {
    case "pointercancel":
    case "lostpointercapture":
    case "remove":
      return { active: false, notify: active };
  }
}
