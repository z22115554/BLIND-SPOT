// 共用數學工具
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a));
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
// 與幀率無關的指數趨近：damp(current, target, lambda, dt)
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};
// 確定性亂數（mulberry32），程式化貼圖用：同一個 seed 產生同一張圖
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 'HH:MM' + 分鐘
export function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + mins + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
export function minutesBetween(a, b) {
  const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number);
  return (h2 * 60 + m2) - (h1 * 60 + m1);
}
