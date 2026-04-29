import { afterEach, describe, expect, it, vi } from "vitest";

const profile = vi.hoisted(() =>
  vi.fn(async () => ({
    id: "user-1",
    company_id: "company-1",
    role: "manager" as string | null,
    email: "u@example.com",
    full_name: "User One",
    team_id: null,
  }))
);
const enqueueZip = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/queries", () => ({ getCurrentProfile: profile }));
vi.mock("@/lib/comping/warmer", () => ({ enqueueZip }));

import { POST } from "./route";

afterEach(() => {
  enqueueZip.mockReset();
  enqueueZip.mockResolvedValue(undefined as never);
  profile.mockReset();
  profile.mockImplementation(async () => ({
    id: "user-1",
    company_id: "company-1",
    role: "manager",
    email: "u@example.com",
    full_name: "User One",
    team_id: null,
  }));
});

function reqWith(body: unknown): Request {
  return new Request("http://localhost/api/comp/warm/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/comp/warm/bulk", () => {
  it("returns 401 when not signed in", async () => {
    profile.mockResolvedValueOnce(null as any);
    const res = await POST(reqWith({ rows: [{ zip: "78701" }] }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when the role is rep", async () => {
    profile.mockResolvedValueOnce({
      id: "u",
      company_id: "c",
      role: "rep",
      email: "x",
      full_name: null,
      team_id: null,
    } as any);
    const res = await POST(reqWith({ rows: [{ zip: "78701" }] }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for non-JSON bodies", async () => {
    const res = await POST(reqWith("not-json"));
    expect(res.status).toBe(400);
  });

  it("returns 422 when rows is empty or malformed", async () => {
    expect((await POST(reqWith({ rows: [] }))).status).toBe(422);
    expect((await POST(reqWith({}))).status).toBe(422);
    expect((await POST(reqWith({ rows: [{ zip: "x" }] }))).status).toBe(422); // zip min length 3
    expect((await POST(reqWith({ rows: [{}] }))).status).toBe(422);
  });

  it("enqueues every valid row, uppercases state, defaults priority to 0", async () => {
    const res = await POST(
      reqWith({
        rows: [
          { zip: "78701", state: "tx", city: "Austin" },
          { zip: "90210", state: "CA", priority: 5 },
          { zip: "10001" },
        ],
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.added).toBe(3);
    expect(json.errors).toEqual([]);
    expect(enqueueZip).toHaveBeenCalledTimes(3);
    expect(enqueueZip).toHaveBeenNthCalledWith(
      1,
      { companyId: "company-1" },
      "78701",
      "TX",
      "Austin",
      0
    );
    expect(enqueueZip).toHaveBeenNthCalledWith(
      2,
      { companyId: "company-1" },
      "90210",
      "CA",
      null,
      5
    );
    expect(enqueueZip).toHaveBeenNthCalledWith(
      3,
      { companyId: "company-1" },
      "10001",
      null,
      null,
      0
    );
  });

  it("reports per-row errors but still counts the successes", async () => {
    enqueueZip
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce(undefined as never);
    const res = await POST(
      reqWith({
        rows: [{ zip: "78701" }, { zip: "78702" }, { zip: "78703" }],
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.added).toBe(2);
    expect(json.errors).toEqual([{ zip: "78702", error: "conflict" }]);
  });

  it("rejects bodies with more than 500 rows", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      zip: String(10000 + i),
    }));
    const res = await POST(reqWith({ rows }));
    expect(res.status).toBe(422);
  });
});
