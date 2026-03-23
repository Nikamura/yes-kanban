/**
 * Programmatic notification tones via Web Audio API (no bundled audio files).
 */

export const NOTIFICATION_SOUNDS = {
  chime: { label: "Chime" },
  bell: { label: "Bell" },
  ding: { label: "Ding" },
} as const;

export type NotificationSoundId = keyof typeof NOTIFICATION_SOUNDS;

/** For `<select>` / string parsing without `as` casts in UI code. */
export function isNotificationSoundId(value: string): value is NotificationSoundId {
  return value in NOTIFICATION_SOUNDS;
}

export function notificationSoundSelectOptions(): ReadonlyArray<{
  id: NotificationSoundId;
  label: string;
}> {
  return (Object.keys(NOTIFICATION_SOUNDS) as NotificationSoundId[]).map((id) => ({
    id,
    label: NOTIFICATION_SOUNDS[id].label,
  }));
}

/** Migrate legacy `sound: boolean` and validate stored string ids. */
export function normalizeStoredNotificationSound(raw: unknown): NotificationSoundId | null {
  if (raw === true) return "chime";
  if (raw === false || raw === null || raw === undefined) return null;
  if (typeof raw === "string" && isNotificationSoundId(raw)) return raw;
  return null;
}

function getAudioContextClass(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  if (w.AudioContext) return w.AudioContext;
  if (w.webkitAudioContext) return w.webkitAudioContext;
  return null;
}

let sharedAudioContext: AudioContext | null = null;

async function getSharedAudioContext(): Promise<AudioContext | null> {
  const Ctor = getAudioContextClass();
  if (!Ctor) return null;
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new Ctor();
  }
  await sharedAudioContext.resume();
  return sharedAudioContext;
}

function playChime(ctx: AudioContext, t0: number): void {
  const dur1 = 0.22;
  const dur2 = 0.22;

  const o1 = ctx.createOscillator();
  const g1 = ctx.createGain();
  o1.type = "sine";
  o1.frequency.setValueAtTime(523.25, t0);
  g1.gain.setValueAtTime(0.0001, t0);
  g1.gain.linearRampToValueAtTime(0.12, t0 + 0.03);
  g1.gain.exponentialRampToValueAtTime(0.0001, t0 + dur1);
  o1.connect(g1).connect(ctx.destination);
  o1.start(t0);
  o1.stop(t0 + dur1 + 0.02);

  const t2 = t0 + dur1 * 0.55;
  const o2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  o2.type = "sine";
  o2.frequency.setValueAtTime(659.25, t2);
  g2.gain.setValueAtTime(0.0001, t2);
  g2.gain.linearRampToValueAtTime(0.1, t2 + 0.03);
  g2.gain.exponentialRampToValueAtTime(0.0001, t2 + dur2);
  o2.connect(g2).connect(ctx.destination);
  o2.start(t2);
  o2.stop(t2 + dur2 + 0.02);
}

function playBell(ctx: AudioContext, t0: number): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(830.61, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.22, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + 0.6);
}

function playDing(ctx: AudioContext, t0: number): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(2093, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.18, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + 0.08);
}

/**
 * Reuses one `AudioContext` per page to avoid browser limits on concurrent contexts.
 * Awaits `resume()` so scheduling runs after the clock advances when the context was suspended.
 */
export async function playNotificationSound(name: NotificationSoundId): Promise<void> {
  try {
    const ctx = await getSharedAudioContext();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    switch (name) {
      case "chime":
        playChime(ctx, t0);
        break;
      case "bell":
        playBell(ctx, t0);
        break;
      case "ding":
        playDing(ctx, t0);
        break;
    }
  } catch {
    /* autoplay blocked or unsupported */
  }
}
