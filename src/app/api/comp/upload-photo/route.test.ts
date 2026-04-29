import { afterEach, describe, expect, it, vi } from "vitest";

const profile = vi.hoisted(() =>
  vi.fn(async () => ({
    id: "user-1",
    company_id: "company-1",
    role: "rep",
    email: "u@example.com",
    full_name: "User One",
    team_id: null,
  }))
);

const upload = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const getPublicUrl = vi.hoisted(() =>
  vi.fn((path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }))
);

vi.mock("@/lib/queries", () => ({ getCurrentProfile: profile }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseAdminClient: () => ({
    storage: {
      from: (_bucket: string) => ({ upload, getPublicUrl }),
    },
  }),
}));

import { POST } from "./route";

afterEach(() => {
  upload.mockClear();
  getPublicUrl.mockClear();
  profile.mockReset();
  profile.mockImplementation(async () => ({
    id: "user-1",
    company_id: "company-1",
    role: "rep",
    email: "u@example.com",
    full_name: "User One",
    team_id: null,
  }));
});

function fileFor(bytes: number, mime = "image/png", name = "test.png"): File {
  const buf = new Uint8Array(bytes);
  return new File([buf], name, { type: mime });
}

function fdReq(file?: File | null): Request {
  const fd = new FormData();
  if (file) fd.append("file", file);
  return new Request("http://localhost/api/comp/upload-photo", {
    method: "POST",
    body: fd,
  });
}

describe("POST /api/comp/upload-photo", () => {
  it("returns 401 when not signed in", async () => {
    profile.mockResolvedValueOnce(null as any);
    const res = await POST(fdReq(fileFor(100)));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the form has no file field", async () => {
    const res = await POST(fdReq());
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty file", async () => {
    const res = await POST(fdReq(fileFor(0)));
    expect(res.status).toBe(400);
  });

  it("returns 413 when the file exceeds 5MB", async () => {
    // 5MB + 1 byte
    const res = await POST(fdReq(fileFor(5 * 1024 * 1024 + 1)));
    expect(res.status).toBe(413);
  });

  it("returns 415 for a disallowed MIME type", async () => {
    const res = await POST(fdReq(fileFor(100, "application/pdf", "x.pdf")));
    expect(res.status).toBe(415);
  });

  it("uploads to <company_id>/<uuid>.<ext> and returns the public URL", async () => {
    const res = await POST(fdReq(fileFor(1024, "image/jpeg", "x.jpg")));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toMatch(/^https:\/\/cdn\.example\/company-1\//);
    expect(json.path).toMatch(/^company-1\/[0-9a-f-]+\.jpg$/);
    expect(upload).toHaveBeenCalledTimes(1);
    const call = upload.mock.calls[0] as unknown as [string, unknown, { contentType: string; upsert: boolean }];
    expect(call[0]).toMatch(/^company-1\/[0-9a-f-]+\.jpg$/);
    expect(call[2].contentType).toBe("image/jpeg");
    expect(call[2].upsert).toBe(false);
  });

  it("propagates a 500 when storage upload errors", async () => {
    upload.mockResolvedValueOnce({ error: { message: "upstream down" } } as any);
    const res = await POST(fdReq(fileFor(100, "image/png")));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("upstream down");
  });
});
