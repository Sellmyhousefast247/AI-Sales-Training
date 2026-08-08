import { describe, expect, it } from "vitest";
import { messageToCandidate, noteToCandidate } from "./ghl-pull";

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

  it("extracts a WAVV MP3 recording attachment", () => {
    const cand = messageToCandidate(conv, {
      id: "msg_6",
      messageType: "TYPE_CALL",
      attachments: ["https://file.wavv.com/recordings/abc123/7193107853.mp3?download=true"],
    });
    expect(cand!.attachmentUrl).toBe(
      "https://file.wavv.com/recordings/abc123/7193107853.mp3?download=true"
    );
  });

  it("ignores non-audio attachments", () => {
    const cand = messageToCandidate(conv, {
      id: "msg_7",
      messageType: "TYPE_CALL",
      attachments: ["https://example.com/photo.jpg"],
    });
    expect(cand!.attachmentUrl).toBeNull();
  });
});

describe("noteToCandidate", () => {
  const wavvNote = {
    id: "note_1",
    userId: "user_9",
    dateAdded: "2026-08-07T21:12:00.000Z",
    body:
      "[ WAVV: 019fd8c9-57a1-7557-98ab-68bc3dfafcc7 ]\n" +
      "To: (719) 310-7853 (5)\nFrom: (720) 897-0691\n" +
      "Duration: 741 seconds\nDisposition: Appointment Set\nTag: wavv-callback (1)\n" +
      "https://file.wavv.com/recordings/b233efb47fbb268f4d2887aca00bc25e/7193107853.mp3?download=true",
  };

  it("parses a WAVV call note into a candidate", () => {
    const cand = noteToCandidate("contact_1", wavvNote);
    expect(cand).not.toBeNull();
    expect(cand!.messageId).toBe("wavv:019fd8c9-57a1-7557-98ab-68bc3dfafcc7");
    expect(cand!.source).toBe("note");
    expect(cand!.durationSec).toBe(741);
    expect(cand!.userId).toBe("user_9");
    expect(cand!.attachmentUrl).toContain("file.wavv.com/recordings/");
    expect(cand!.dateAdded).toBe("2026-08-07T21:12:00.000Z");
  });

  it("ignores notes without a WAVV recording link", () => {
    expect(
      noteToCandidate("contact_1", { id: "n2", body: "Summary: talked to seller, follow up Friday." })
    ).toBeNull();
  });

  it("falls back to the note id when the WAVV uuid is missing", () => {
    const cand = noteToCandidate("contact_1", {
      id: "note_3",
      body: "https://file.wavv.com/recordings/deadbeef/5551234567.mp3?download=true",
    });
    expect(cand!.messageId).toBe("wavv-note:note_3");
  });
});
