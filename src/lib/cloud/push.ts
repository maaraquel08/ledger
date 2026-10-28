import { sb, VAPID_PUBLIC_KEY } from "../supabase";

/*
 * Web Push for the weekly review and material alerts (D-0016). Only offered when the app has a
 * VAPID public key; on iPhone it works only once Ledger is on the Home Screen.
 */

export type PushSupport = "ok" | "no-key" | "ios-home-screen" | "unsupported";

const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function pushSupport(): PushSupport {
  if (!VAPID_PUBLIC_KEY) return "no-key";
  if (ios() && !standalone()) return "ios-home-screen";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}

function keyBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
}

export async function pushIsOn(): Promise<boolean> {
  if (pushSupport() !== "ok" || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/** Ask permission, subscribe, store the subscription. Returns why it didn't, or null. */
export async function turnPushOn(): Promise<"denied" | null> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "denied";
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const json = sub.toJSON();
  const { error } = await sb()
    .from("push_subscriptions")
    .upsert({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "", user_agent: navigator.userAgent }, { onConflict: "endpoint" });
  if (error) {
    await sub.unsubscribe();
    throw error;
  }
  await sb().from("profiles").upsert({ push_enabled: true }, { onConflict: "user_id" });
  return null;
}

export async function turnPushOff() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await sb().from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
  await sb().from("profiles").upsert({ push_enabled: false }, { onConflict: "user_id" });
}
