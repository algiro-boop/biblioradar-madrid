import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeDeviceHash,
  DEVICE_HASH_PATTERN,
  getDeviceHash,
  getOrCreateDeviceId,
  getRecentReport,
  isValidDeviceHash,
  minutesUntilNextReport,
  randomUuid,
  recordRecentReport,
  REPORT_COOLDOWN_MS,
  type KeyValueStorage,
} from "@/lib/device";

const crypto = webcrypto as unknown as Crypto;

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("device_hash", () => {
  it("cumple exactamente ^[0-9a-f]{64}$", async () => {
    for (let i = 0; i < 25; i++) {
      const hash = await getDeviceHash({ storage: memoryStorage(), crypto });
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).toHaveLength(64);
      expect(hash).toBe(hash.toLowerCase());
    }
  });

  it("es estable para el mismo dispositivo (id persistido)", async () => {
    const storage = memoryStorage();
    const a = await getDeviceHash({ storage, crypto });
    const b = await getDeviceHash({ storage, crypto });
    expect(a).toBe(b);
    expect(storage.data.size).toBe(1);
  });

  it("es distinto entre dispositivos", async () => {
    const a = await getDeviceHash({ storage: memoryStorage(), crypto });
    const b = await getDeviceHash({ storage: memoryStorage(), crypto });
    expect(a).not.toBe(b);
  });

  it("no expone el identificador original", async () => {
    const storage = memoryStorage();
    const id = getOrCreateDeviceId({ storage, crypto });
    const hash = await computeDeviceHash(id, { crypto });
    expect(hash).not.toContain(id.replace(/-/g, ""));
  });

  it("regenera el id si el guardado está corrupto", () => {
    const storage = memoryStorage();
    storage.setItem("biblioradar:device-id:v1", "no-es-un-uuid");
    const id = getOrCreateDeviceId({ storage, crypto });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("genera UUID v4 válidos sin randomUUID", () => {
    const noRandomUuid = { getRandomValues: crypto.getRandomValues.bind(crypto), subtle: crypto.subtle } as Crypto;
    expect(randomUuid(noRandomUuid)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("isValidDeviceHash rechaza mayúsculas, longitudes erróneas y no-hex", () => {
    expect(isValidDeviceHash("a".repeat(64))).toBe(true);
    expect(isValidDeviceHash("A".repeat(64))).toBe(false);
    expect(isValidDeviceHash("a".repeat(63))).toBe(false);
    expect(isValidDeviceHash("a".repeat(65))).toBe(false);
    expect(isValidDeviceHash("g".repeat(64))).toBe(false);
    expect(isValidDeviceHash(null)).toBe(false);
    expect(DEVICE_HASH_PATTERN.source).toBe("^[0-9a-f]{64}$");
  });
});

describe("registro local de reportes recientes", () => {
  const t0 = Date.UTC(2026, 9, 23, 10, 0, 0);

  it("bloquea durante 30 minutos y luego libera", () => {
    const storage = memoryStorage();
    recordRecentReport("lib-1", 75, t0, storage);
    expect(getRecentReport("lib-1", t0 + 60_000, storage)).toEqual({ value: 75, at: t0 });
    expect(minutesUntilNextReport("lib-1", t0 + 60_000, storage)).toBe(29);
    expect(minutesUntilNextReport("lib-1", t0 + REPORT_COOLDOWN_MS - 1, storage)).toBe(1);
    expect(getRecentReport("lib-1", t0 + REPORT_COOLDOWN_MS, storage)).toBeNull();
    expect(minutesUntilNextReport("lib-1", t0 + REPORT_COOLDOWN_MS, storage)).toBe(0);
  });

  it("es independiente por biblioteca", () => {
    const storage = memoryStorage();
    recordRecentReport("lib-1", 30, t0, storage);
    expect(getRecentReport("lib-2", t0, storage)).toBeNull();
  });

  it("tolera datos corruptos en localStorage", () => {
    const storage = memoryStorage();
    storage.setItem("biblioradar:recent-reports:v1", "{not json");
    expect(getRecentReport("lib-1", t0, storage)).toBeNull();
    recordRecentReport("lib-1", 100, t0, storage);
    expect(getRecentReport("lib-1", t0, storage)?.value).toBe(100);
  });
});
