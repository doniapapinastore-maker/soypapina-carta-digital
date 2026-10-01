// netlify/functions/listos.js
//
// "Pedido listo": une el KDS de la cocina con el celular del cliente.
//
//  POST desde el KDS (header X-Server-Token = LISTOS_KEY):
//     body { order, name, code, channel, status }   status: "ready" (listo) o "cancelled" (anulado)
//     → se guarda, y si el cliente activó las notificaciones, se le manda una al teléfono.
//  POST desde el celular { action: "subscribe", code, name, since, subscription }
//     → el cliente pidió que le avisemos con una notificación.
//  GET ?code=4821 → el celular pregunta si SU pedido ya está listo (o si se anuló).
//  GET (sin código) → últimos pedidos listos (no se usa en la dark kitchen, queda disponible).
//
// Variables en Netlify:
//   LISTOS_KEY          clave de avisos (la misma que se carga en el KDS)
//   VAPID_PUBLIC_KEY    clave pública de notificaciones
//   VAPID_PRIVATE_KEY   clave privada de notificaciones
//
// Los datos se guardan en Netlify Blobs y se borran solos a las 3 horas.

const { getStore, connectLambda } = require("@netlify/blobs");
const webpush = require("web-push");

const KEEP_MS = 3 * 60 * 60 * 1000;   // se guardan 3 horas
const SALON_MS = 20 * 60 * 1000;
const SALON_MAX = 12;

const clean = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const normName = (n) => clean(n, 60).toUpperCase();
const digits = (v, max) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, max);

function reply(statusCode, obj, cacheSeconds) {
  const headers = { "Content-Type": "application/json" };
  if (cacheSeconds) {
    // Netlify guarda la respuesta unos segundos: muchos celulares preguntando cuestan casi nada
    headers["Cache-Control"] = "public, max-age=0, must-revalidate";
    headers["Netlify-CDN-Cache-Control"] = `public, s-maxage=${cacheSeconds}, stale-while-revalidate=10`;
    headers["Netlify-Vary"] = "query=code";
  } else {
    headers["Cache-Control"] = "no-store";
  }
  return { statusCode, headers, body: JSON.stringify(obj) };
}

function openStore(event) {
  try { connectLambda(event); } catch (e) { /* en entornos nuevos no hace falta */ }
  return getStore("listos");
}

function keyTime(key) {
  const m = /^[rcs]\/(\d+)/.exec(key);
  return m ? Number(m[1]) : 0;
}

async function prune(store, now) {
  const { blobs } = await store.list();
  const old = blobs.filter((b) => { const at = keyTime(b.key); return !at || now - at > KEEP_MS; });
  await Promise.all(old.slice(0, 60).map((b) => store.delete(b.key)));
}

// ─── Notificaciones al teléfono ───────────────────────────────────────────
let pushReady = null;
function canPush() {
  if (pushReady !== null) return pushReady;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { pushReady = false; return false; }
  try {
    webpush.setVapidDetails("mailto:doniapapinastore@gmail.com", pub, priv);
    pushReady = true;
  } catch (e) {
    console.error("Claves de notificación inválidas:", e && e.message);
    pushReady = false;
  }
  return pushReady;
}

async function sendPushes(store, entry) {
  if (!entry.code || !canPush()) return 0;
  const { blobs } = await store.list({ prefix: "s/" });
  let sent = 0;
  for (const b of blobs) {
    const m = /^s\/(\d+)-(\d+)-/.exec(b.key);
    if (!m || m[2] !== entry.code) continue;
    const sub = await store.get(b.key, { type: "json" });
    if (!sub || !sub.subscription) continue;
    if (sub.name && entry.name && sub.name !== entry.name) continue;   // mismo código pero otro cliente
    if (sub.since && entry.at < sub.since - 60000) continue;          // aviso anterior a su pedido
    const ready = entry.status !== "cancelled";
    const payload = JSON.stringify({
      title: ready ? "¡Tu pedido está listo! 🍔" : "Hubo un problema con tu pedido",
      body: ready
        ? `Pasá a retirarlo por Doña Papina. Tu código: ${entry.code}`
        : "Escribinos por WhatsApp y lo resolvemos.",
      tag: `pedido-${entry.code}`,
      url: "/",
    });
    try {
      await webpush.sendNotification(sub.subscription, payload, { TTL: 3600, urgency: "high" });
      sent++;
    } catch (err) {
      console.warn("No se pudo mandar la notificación:", err && (err.statusCode || err.message));
    }
    await store.delete(b.key); // cada suscripción avisa una sola vez
  }
  return sent;
}

exports.handler = async (event) => {
  try {
    const store = openStore(event);
    const now = Date.now();

    if (event.httpMethod === "POST") {
      let b = {};
      try { b = JSON.parse(event.body || "{}"); } catch (e) { b = {}; }

      // ───── El celular pide que le avisemos con una notificación ─────
      if (b.action === "subscribe") {
        const code = digits(b.code, 6);
        const sub = b.subscription || {};
        const okSub = sub && typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint) &&
          sub.endpoint.length < 1000 && sub.keys && sub.keys.p256dh && sub.keys.auth;
        if (!code || !okSub) return reply(400, { ok: false, error: "Datos incompletos" });
        const rnd = Math.random().toString(36).slice(2, 7);
        await store.setJSON(`s/${now}-${code}-${rnd}`, {
          code,
          name: normName(b.name),
          since: Number(b.since) || now,
          subscription: { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } },
        });
        return reply(200, { ok: true });
      }

      // ───── El KDS avisa que un pedido está listo o anulado ─────
      const key = process.env.LISTOS_KEY;
      const sent = (event.headers && (event.headers["x-server-token"] || event.headers["X-Server-Token"])) || "";
      if (!key || sent !== key) return reply(401, { ok: false, error: "Clave de avisos incorrecta" });

      const entry = {
        order: clean(b.order, 20),
        name: normName(b.name),
        code: digits(b.code, 6),
        channel: clean(b.channel, 30),
        status: b.status === "cancelled" ? "cancelled" : "ready",
        at: now,
      };
      if (!entry.order && !entry.code) return reply(400, { ok: false, error: "Falta el pedido" });

      const rnd = Math.random().toString(36).slice(2, 7);
      if (entry.status === "ready") await store.setJSON(`r/${now}-${rnd}`, entry);
      if (entry.code) await store.setJSON(`c/${now}-${entry.code}`, entry);
      let pushes = 0;
      try { pushes = await sendPushes(store, entry); } catch (e) { console.warn("Notificaciones:", e && e.message); }
      try { await prune(store, now); } catch (e) { console.warn("No se pudo limpiar:", e && e.message); }
      return reply(200, { ok: true, notificaciones: pushes });
    }

    if (event.httpMethod !== "GET") return reply(405, { ok: false, error: "Método no permitido" });

    const q = event.queryStringParameters || {};

    // ───── El celular del cliente pregunta por su código ─────
    if (q.code) {
      const code = digits(q.code, 6);
      const { blobs } = await store.list({ prefix: "c/" });
      const mine = blobs
        .map((b) => { const m = /^c\/(\d+)-(\d+)$/.exec(b.key); return m ? { key: b.key, at: Number(m[1]), code: m[2] } : null; })
        .filter((x) => x && x.code === code && now - x.at < KEEP_MS)
        .sort((a, b) => b.at - a.at);
      const list = [];
      for (const x of mine.slice(0, 5)) {
        const e = await store.get(x.key, { type: "json" });
        if (e) list.push({ name: e.name, at: e.at, status: e.status || "ready" });
      }
      return reply(200, { ok: true, ready: list }, 5);
    }

    // ───── Últimos pedidos listos ─────
    const { blobs } = await store.list({ prefix: "r/" });
    const recent = blobs
      .map((b) => ({ key: b.key, at: keyTime(b.key) }))
      .filter((x) => x.at && now - x.at < SALON_MS)
      .sort((a, b) => b.at - a.at)
      .slice(0, SALON_MAX);
    const items = [];
    for (const x of recent) {
      const e = await store.get(x.key, { type: "json" });
      if (e) items.push({ name: e.name, order: e.order, code: e.code, at: e.at });
    }
    return reply(200, { ok: true, now, items }, 4);
  } catch (err) {
    console.error("Error en listos:", err);
    return reply(500, { ok: false, error: "Error interno" });
  }
};
