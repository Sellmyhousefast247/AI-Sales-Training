import { describe, it, expect } from "vitest";
import { gohighlevel } from "./gohighlevel";
import { wavv } from "./wavv";
import { smrtphone } from "./smrtphone";
import { dialpad } from "./dialpad";
import { aircall } from "./aircall";
import { generic } from "./generic";
import { getAdapter } from "../index";

describe("getAdapter", () => {
  it("maps zapier and n8n to the generic adapter", () => {
    expect(getAdapter("zapier")?.provider).toBe("webhook");
    expect(getAdapter("n8n")?.provider).toBe("webhook");
  });
  it("returns null for unknown providers", () => {
    expect(getAdapter("nope")).toBeNull();
  });
});

describe("gohighlevel adapter", () => {
  it("normalizes a nested call payload", () => {
    const [call] = gohighlevel.normalize({
      contact_id: "c1",
      first_name: "Debra",
      last_name: "Jones",
      phone: "+12105551234",
      full_address: "301 Main St",
      user: { id: "u9", email: "closer@x.com" },
      call: {
        id: "call-123",
        direction: "outbound",
        duration: 512,
        recordingUrl: "https://rec/x.mp3",
        startTime: "2026-08-06T14:00:00Z",
        status: "completed",
      },
    });
    expect(call.externalId).toBe("call-123");
    expect(call.direction).toBe("outbound");
    expect(call.durationSec).toBe(512);
    expect(call.repHints).toContain("u9");
    expect(call.repHints).toContain("closer@x.com");
    expect(call.sellerName).toBe("Debra Jones");
    expect(call.recordingUrl).toBe("https://rec/x.mp3");
  });

  it("normalizes a flat payload", () => {
    const [call] = gohighlevel.normalize({
      call_id: "f1",
      call_recording_url: "https://rec/y.mp3",
      phone: "+1830",
      first_name: "Sam",
    });
    expect(call.externalId).toBe("f1");
    expect(call.recordingUrl).toBe("https://rec/y.mp3");
  });

  it("ignores non-terminal statuses", () => {
    expect(gohighlevel.normalize({ call: { id: "x", status: "ringing" } })).toEqual([]);
  });
});

describe("wavv adapter", () => {
  it("normalizes an enveloped call.completed", () => {
    const [call] = wavv.normalize({
      event: "call.completed",
      data: {
        callId: "w1",
        userEmail: "rep@x.com",
        direction: "outbound",
        duration: 120,
        to: "+1830",
        contact: { name: "Deb" },
        recordingUrl: "https://rec/w.mp3",
        startedAt: "2026-08-06T15:00:00Z",
      },
    });
    expect(call.externalId).toBe("w1");
    expect(call.sellerPhone).toBe("+1830");
    expect(call.repHints).toContain("rep@x.com");
  });

  it("skips call.started events", () => {
    expect(wavv.normalize({ event: "call.started", data: { callId: "w2" } })).toEqual([]);
  });
});

describe("smrtphone adapter", () => {
  it("normalizes call.completed", () => {
    const [call] = smrtphone.normalize({
      event: "call.completed",
      call: {
        uuid: "s1",
        direction: "inbound",
        duration: 90,
        from: "+1830",
        to: "+1210",
        recording_url: "https://rec/s.mp3",
        user: { email: "rep@x.com" },
      },
    });
    expect(call.externalId).toBe("s1");
    expect(call.direction).toBe("inbound");
    expect(call.sellerPhone).toBe("+1830"); // inbound → seller is 'from'
  });
});

describe("dialpad adapter", () => {
  it("normalizes a hangup event with ms duration and epoch start", () => {
    const [call] = dialpad.normalize({
      call_id: 77,
      state: "hangup",
      direction: "outbound",
      date_started: 1754400000000,
      duration: 315000,
      external_number: "+1830",
      target: { id: 5, email: "rep@x.com" },
      recording_url: ["https://rec/d.mp3"],
    });
    expect(call.externalId).toBe("77");
    expect(call.durationSec).toBe(315);
    expect(call.recordingUrl).toBe("https://rec/d.mp3");
    expect(call.callDatetime).toBe(new Date(1754400000000).toISOString());
  });

  it("skips non-hangup states", () => {
    expect(dialpad.normalize({ call_id: 1, state: "calling" })).toEqual([]);
  });
});

describe("aircall adapter", () => {
  it("normalizes call.ended with unix seconds and recording object", () => {
    const [call] = aircall.normalize({
      event: "call.ended",
      data: {
        id: 42,
        direction: "inbound",
        duration: 200,
        started_at: 1754400000,
        raw_digits: "+1830",
        user: { id: 3, email: "rep@x.com" },
        contact: { first_name: "Deb", last_name: "Jones" },
        recording: { url: "https://rec/a.mp3" },
      },
    });
    expect(call.externalId).toBe("42");
    expect(call.sellerName).toBe("Deb Jones");
    expect(call.recordingUrl).toBe("https://rec/a.mp3");
    expect(call.callDatetime).toBe(new Date(1754400000 * 1000).toISOString());
  });
});

describe("generic adapter", () => {
  it("normalizes the documented contract", () => {
    const [call] = generic.normalize({
      external_id: "g1",
      call_datetime: "2026-08-06T16:00:00Z",
      direction: "outbound",
      duration_sec: 400,
      rep: "closer@x.com",
      seller_name: "Deb",
      recording_url: "https://rec/g.mp3",
    });
    expect(call.externalId).toBe("g1");
    expect(call.repHints).toEqual(["closer@x.com"]);
  });

  it("accepts a batch under `calls`", () => {
    const calls = generic.normalize({
      calls: [
        { external_id: "a", transcript: "REP: hi" },
        { external_id: "b", recording_url: "https://r/b.mp3" },
      ],
    });
    expect(calls).toHaveLength(2);
  });

  it("drops items with no external id", () => {
    expect(generic.normalize({ seller_name: "nobody" })).toEqual([]);
  });
});
