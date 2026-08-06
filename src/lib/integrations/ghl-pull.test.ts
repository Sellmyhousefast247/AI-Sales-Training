import { describe, expect, it } from "vitest";
import { messageToCandidate } from "./ghl-pull";

const conv = { id: "conv_1", contactId: "contact_1" };

describe("messageToCandidate", () => {
  it("extracts a completed TYPE_CALL message", () => {
    const cand = messageToCandidate(conv, {
      id: "msg_1",
      messageType: "TYPE_CALL",
      direction: "outbound",
      status: "completed",
      dateAdded: "2026-08-06T20:35:00.000Z",
      userId: "user_9",
      meta: { call: { duration: 327 } },
    });
    expect(cand).not.toBeNull();
    expect(cand!.messageId).toBe("msg_1");
    expect(cand!.conversationId).toBe("conv_1");
    expect(cand!.contactId).toBe("contact_1");
    expect(cand!.direction).toBe("outbound");
    expect(cand!.durationSec).toBe(327);
    expect(cand!.userId).toBe("user_9");
    expect(cand!.dateAdded).toBe("2026-08-06T20:35:00.000Z");
  });

  it("ignores non-call messages", () => {
    expect(
      messageToCandidate(conv, { id: "msg_2", messageType: "TYPE_SMS", status: "delivered" })
    ).toBeNull();
  });

  it("ignores in-flight call events", () => {
    expect(
      messageToCandidate(conv, { id: "msg_3", messageType: "TYPE_CALL", status: "ringing" })
    ).toBeNull();
  });

  it("keeps calls with unknown status and missing duration", () => {
    const cand = messageToCandidate(conv, { id: "msg_4", messageType: "TYPE_CALL" });
    expect(cand).not.toBeNull();
    expect(cand!.durationSec).toBeNull();
    expect(cand!.direction).toBeNull();
  });

  it("reads flat duration variants", () => {
    const cand = messageToCandidate(conv, {
      id: "msg_5",
      messageType: "TYPE_CALL",
      callDuration: "61",
    });
    expect(cand!.durationSec).toBe(61);
  });
});
