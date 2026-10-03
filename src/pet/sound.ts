/**
 * 宠物音效（Web Audio 合成，无需音频素材）。
 * 金币音带节流，避免连续下载时声音叠加。
 */

let ctx: AudioContext | null = null;
let lastCoinAt = 0;

export function playCoinSound(): void {
  const now = Date.now();
  if (now - lastCoinAt < 250) return;
  lastCoinAt = now;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1180, t);
    osc.frequency.setValueAtTime(1760, t + 0.07);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.13, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  } catch {
    // 忽略：无音频设备/被策略拦截等
  }
}

/** 皮肤解锁庆祝音（上行琶音） */
export function playUnlockSound(): void {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume();

    const t0 = ctx.currentTime;
    const notes = [660, 880, 1108, 1318];
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      const t = t0 + i * 0.09;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    });
  } catch {
    // ignore
  }
}
