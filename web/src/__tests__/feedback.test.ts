import { afterEach, describe, expect, it, vi } from "vitest";
import { feedbackError, feedbackValidation, submitFeedback } from "@/lib/feedback";
import { getSupabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({ getSupabase: vi.fn() }));
afterEach(() => vi.clearAllMocks());
const input = { category: "sugerencia" as const, message: "  Una buena idea  ", contactInfo: "  ", libraryId: null, deviceHash: "a".repeat(64) };

describe("feedback", () => {
  it.each(["", "1234", " ".repeat(10), "a".repeat(1001), "💡💡💡"])("valida la longitud real de %j", (message) => {
    expect(feedbackValidation({ ...input, message })).not.toBeNull();
  });
  it("admite límites 5 y 1000 y rechaza contactos largos", () => {
    for (const message of ["12345", "a".repeat(1000), "💡💡💡💡💡"]) expect(feedbackValidation({ ...input, message })).toBeNull();
    expect(feedbackValidation({ ...input, contactInfo: "a".repeat(201) })).not.toBeNull();
  });
  it("normaliza campos y utiliza exclusivamente el RPC", async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: "00000000-0000-0000-0000-000000000001", error: null });
    const rpc = vi.fn(() => ({ abortSignal }));
    vi.mocked(getSupabase).mockReturnValue({ rpc } as unknown as ReturnType<typeof getSupabase>);
    expect(await submitFeedback(input)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("submit_feedback", {
      p_category: "sugerencia", p_message: "Una buena idea", p_contact_info: null,
      p_device_hash: "a".repeat(64), p_library_id: null,
    });
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it("no envía entradas inválidas", async () => {
    expect((await submitFeedback({ ...input, message: "x" })).ok).toBe(false);
    expect((await submitFeedback({ ...input, deviceHash: "invalid" })).ok).toBe(false);
    expect(getSupabase).not.toHaveBeenCalled();
  });
  it("no confirma un envío rechazado por la base de datos", async () => {
    vi.mocked(getSupabase).mockReturnValue({ rpc: () => ({ abortSignal: async () => ({ error: { code: "P0001", details: '{"retry_after_seconds":120}' }, data: null }) }) } as unknown as ReturnType<typeof getSupabase>);
    const result = await submitFeedback(input);
    expect(result.ok).toBe(false);
    expect("message" in result && result.message).toContain("2 min");
  });
  it("mapea fallos sin exponer detalles privados", () => {
    expect(feedbackError({ code: "22023" })).toMatch(/Revisa/);
    expect(feedbackError({ message: "secret server information" })).not.toContain("secret");
  });
});
