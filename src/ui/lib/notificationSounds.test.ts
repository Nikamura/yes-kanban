import { describe, it, expect } from "bun:test";
import {
  NOTIFICATION_SOUNDS,
  isNotificationSoundId,
  normalizeStoredNotificationSound,
  playNotificationSound,
} from "./notificationSounds";

describe("normalizeStoredNotificationSound", () => {
  it("migrates true to chime", () => {
    expect(normalizeStoredNotificationSound(true)).toBe("chime");
  });
  it("migrates false to null", () => {
    expect(normalizeStoredNotificationSound(false)).toBeNull();
  });
  it("treats null and undefined as off", () => {
    expect(normalizeStoredNotificationSound(null)).toBeNull();
    expect(normalizeStoredNotificationSound(undefined)).toBeNull();
  });
  it("accepts valid ids", () => {
    expect(normalizeStoredNotificationSound("bell")).toBe("bell");
    expect(normalizeStoredNotificationSound("ding")).toBe("ding");
  });
  it("rejects unknown strings", () => {
    expect(normalizeStoredNotificationSound("nope")).toBeNull();
  });
});

describe("isNotificationSoundId", () => {
  it("accepts only known ids", () => {
    expect(isNotificationSoundId("chime")).toBe(true);
    expect(isNotificationSoundId("bell")).toBe(true);
    expect(isNotificationSoundId("nope")).toBe(false);
  });
});

describe("NOTIFICATION_SOUNDS", () => {
  it("exposes chime, bell, ding with labels", () => {
    expect(NOTIFICATION_SOUNDS.chime.label).toBe("Chime");
    expect(NOTIFICATION_SOUNDS.bell.label).toBe("Bell");
    expect(NOTIFICATION_SOUNDS.ding.label).toBe("Ding");
  });
});

describe("playNotificationSound", () => {
  it("resolves when Web Audio is unavailable (no window / no AudioContext)", async () => {
    await playNotificationSound("chime");
  });
});
