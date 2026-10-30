import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitReport } from "@/lib/supabase";
import type { ReportTag } from "@/lib/community";
const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: api.rpc }) }));
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test");
  api.rpc.mockReset().mockResolvedValue({ data: "report", error: null });
});
const input = { libraryId: "one", value: 75 as const, deviceHash: "a".repeat(64), lat: 40.4, lng: -3.7 };
describe("report RPC payload compatibility", () => {
  it("omits the optional parameter when empty, so old and new deployments accept reports", async () => {
    expect(await submitReport({ ...input, tags: [] })).toEqual({ ok: true, reportId: "report" });
    expect(api.rpc).toHaveBeenCalledWith("submit_report", {
      p_library_id: "one", p_reported_value: 75, p_device_hash: input.deviceHash, p_user_lat: 40.4, p_user_lng: -3.7,
    });
  });
  it("forwards validated tags to PostgreSQL", async () => {
    await submitReport({ ...input, tags: ["silent", "temp_hot"] });
    expect(api.rpc).toHaveBeenCalledWith("submit_report", expect.objectContaining({ p_tags: ["silent", "temp_hot"] }));
  });
  it("rejects conflicting or unknown tags before making a request", async () => {
    for (const tags of [["silent", "noisy"], ["unknown"]]) {
      expect(await submitReport({ ...input, tags: tags as ReportTag[] })).toMatchObject({ ok: false, error: { kind: "invalid" } });
    }
    expect(api.rpc).not.toHaveBeenCalled();
  });
});
