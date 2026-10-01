// netlify/functions/listos.js
//
// "Pedido listo": une el KDS de la cocina con el celular del cliente.
//
//  POST desde el KDS (header X-Server-Token = LISTOS_KEY):
//     body { order, name, code, channel, status }
//       status: "ready" (listo), "cancelled" (anulado) o "reminder" (recordatorio a los 3 minutos,
//       solo si el cliente todavía no abrió el aviso)
//     → se guarda, y si el cliente activó las notificaciones, se le manda una al teléfono.
//  POST desde el celular { action: "subscribe", code, name, since, subscription }
//     → el cliente pidió que le avisemos con una notificación.
//  POST desde el celular { action: "ack", code, name }
//     → el cliente ya vio el aviso de "listo" (no se le manda el recordatorio).
//  GET ?code=4821 → el celular pregunta si SU pedido ya está listo (o si se anuló) y la hora estimada.
//  GET ?estado=1  → la carta pregunta si los pedidos web están en pausa.
//  GET ?registro=AAAA-MM-DD&clave=LISTOS_KEY → tiempos reales de ese día (CSV, para ajustar los tiempos).
//  POST desde el KDS (con la clave):
//     { action: "pause", paused }      pausar / reanudar los pedidos web
//     { action: "pause-status" }       el KDS pregunta si está en pausa
//     { action: "eta", items }         hora estimada de cada pedido web en cocina
//     { action: "log", ... }           cuánto tardó de verdad un pedido
//  GET (sin nada) → últimos pedidos listos (no se usa en la dark kitchen, queda disponible).
//
// Variables en Netlify:
//   LISTOS_KEY          clave de avisos (la misma que se carga en el KDS)
//   VAPID_PUBLIC_KEY    clave pública de notificaciones
//   VAPID_PRIVATE_KEY   clave privada de notificaciones
//
// Los datos se guardan en Netlify Blobs y se borran solos a las 2 horas.

const { getStore, connectLambda } = require("@netlify/blobs");
const webpush = require("web-push");

const KEEP_MS = 2 * 60 * 60 * 1000;   // se guardan 2 horas
const SALON_MS = 20 * 60 * 1000;
const SALON_MAX = 12;

const clean = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const normName = (n) => clean(n, 60).toUpperCase();
const digits = (v, max) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, max);
// Identificador corto del celular (a partir de la dirección de su suscripción)
function phoneId(endpoint) {
  let h = 2166136261;
  const t = String(endpoint || "");
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

function reply(statusCode, obj, cacheSeconds) {
  const headers = { "Content-Type": "application/json" };
  if (cacheSeconds) {
    // Netlify guarda la respuesta muy poquito (2 s): muchos celulares preguntando cuestan casi nada,
    // y el aviso llega casi en el acto. Nunca se entrega una respuesta vieja.
    headers["Cache-Control"] = "public, max-age=0, must-revalidate";
    headers["Netlify-CDN-Cache-Control"] = `public, s-maxage=${cacheSeconds}`;
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
  const old = blobs.filter((b) => {
    if (!/^[rcs]\//.test(b.key)) return false; // configuración, horas estimadas y registro no se borran acá
    const at = keyTime(b.key);
    return !at || now - at > KEEP_MS;
  });
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

const VIBRATE = [600, 200, 600, 200, 600, 200, 1200];

function payloadFor(entry, kind) {
  const many = entry.count > 1;
  if (kind === "reminder") {
    return { title: many ? `Tus ${entry.count} pedidos te esperan` : "Tu pedido te espera", body: `Ya está${many ? "n" : ""} listo${many ? "s" : ""} para retirar en Doña Papina. Tu código: ${entry.code}`, tag: `pedido-${entry.code}`, code: entry.code, name: entry.name, status: "ready", url: "/" };
  }
  if (kind === "cancelled") {
    return { title: "Hubo un problema con tu pedido", body: "Escribinos por WhatsApp y lo resolvemos.", tag: `pedido-${entry.code}`, code: entry.code, name: entry.name, status: "cancelled", url: "/" };
  }
  return { title: many ? `¡Tus ${entry.count} pedidos están listos!` : "¡Tu pedido está listo!", body: `Pasá a retirar${many ? "los" : "lo"} por Doña Papina. Tu código: ${entry.code}`, tag: `pedido-${entry.code}`, code: entry.code, name: entry.name, status: "ready", url: "/" };
}

// Suscripciones de este código y este cliente
async function subsFor(store, entry) {
  const { blobs } = await store.list({ prefix: "s/" });
  const out = [];
  for (const b of blobs) {
    const m = /^s\/(\d+)-(\d+)-/.exec(b.key);
    if (!m || m[2] !== entry.code) continue;
    const sub = await store.get(b.key, { type: "json" });
    if (!sub || !sub.subscription) continue;
    if (sub.name && entry.name && sub.name !== entry.name) continue;   // mismo código pero otro cliente
    out.push({ key: b.key, sub, phone: phoneId(sub.subscription.endpoint) });
  }
  return out;
}

async function push(sub, payload) {
  await webpush.sendNotification(sub.subscription, JSON.stringify(Object.assign({ vibrate: VIBRATE }, payload)), { TTL: 3600, urgency: "high" });
}

async function sendPushes(store, entry) {
  if (!entry.code || !canPush()) return 0;
  let sent = 0;
  const done = {}; // un solo aviso por celular, aunque haya anotaciones repetidas viejas
  for (const { key, sub, phone } of await subsFor(store, entry)) {
    if (done[phone]) { await store.delete(key); continue; }
    done[phone] = true;
    if (entry.status === "reminder") {
      // Recordatorio: solo a quien recibió el "listo" y todavía no lo abrió
      if (!sub.notifiedAt || sub.ack) continue;
      try { await push(sub, payloadFor(entry, "reminder")); sent++; } catch (err) { console.warn("Recordatorio:", err && (err.statusCode || err.message)); }
      await store.delete(key);
      continue;
    }
    if (sub.since && entry.at < sub.since - 60000) continue;           // aviso anterior a su pedido
    if (sub.notifiedAt) continue;                                       // ya avisado
    try {
      await push(sub, payloadFor(entry, entry.status));
      sent++;
    } catch (err) {
      console.warn("No se pudo mandar la notificación:", err && (err.statusCode || err.message));
      await store.delete(key);
      continue;
    }
    if (entry.status === "cancelled") await store.delete(key);
    else await store.setJSON(key, Object.assign({}, sub, { notifiedAt: entry.at })); // queda para el recordatorio
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
        // Una sola anotación por celular y por pedido: si ya estaba, se reemplaza (no se suma otra)
        const phone = phoneId(sub.endpoint);
        let prev = null;
        const { blobs } = await store.list({ prefix: "s/" });
        for (const old of blobs) {
          const m = /^s\/(\d+)-(\d+)-([a-z0-9]+)$/.exec(old.key);
          if (!m || m[2] !== code) continue;
          const o = await store.get(old.key, { type: "json" });
          // mismo celular (también las anotaciones repetidas del formato anterior)
          if (!o || !o.subscription || phoneId(o.subscription.endpoint) !== phone) continue;
          if (!prev) prev = o;
          await store.delete(old.key);
        }
        await store.setJSON(`s/${now}-${code}-${phone}`, {
          code,
          name: normName(b.name),
          since: Number(b.since) || now,
          notifiedAt: prev && prev.notifiedAt ? prev.notifiedAt : undefined,
          ack: prev && prev.ack ? true : undefined,
          subscription: { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } },
        });
        return reply(200, { ok: true });
      }

      // ───── El celular avisa que el cliente ya vio el "listo" ─────
      if (b.action === "ack") {
        const entry = { code: digits(b.code, 6), name: normName(b.name) };
        if (!entry.code) return reply(400, { ok: false });
        for (const { key, sub } of await subsFor(store, entry)) {
          if (sub.notifiedAt || b.final) await store.setJSON(key, Object.assign({}, sub, { ack: true }));
        }
        return reply(200, { ok: true });
      }

      // ───── El KDS avisa que un pedido está listo o anulado ─────
      const key = process.env.LISTOS_KEY;
      const sent = (event.headers && (event.headers["x-server-token"] || event.headers["X-Server-Token"])) || "";
      if (!key || sent !== key) return reply(401, { ok: false, error: "Clave de avisos incorrecta" });

      // Pausar / reanudar pedidos web
      if (b.action === "pause") {
        const cfg = { paused: !!b.paused, at: now };
        await store.setJSON("cfg/paused", cfg);
        return reply(200, { ok: true, paused: cfg.paused });
      }
      if (b.action === "pause-status") {
        const cfg = await store.get("cfg/paused", { type: "json" });
        return reply(200, { ok: true, paused: !!(cfg && cfg.paused) });
      }
      // Hora estimada de cada pedido web que está en cocina
      if (b.action === "eta") {
        const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map((x) => ({
          code: digits(x.code, 6), name: normName(x.name), eta: Number(x.eta) || 0,
        })).filter((x) => x.code && x.eta);
        await store.setJSON("eta/actual", { at: now, items });
        return reply(200, { ok: true });
      }
      // Registro de cuánto tardó de verdad cada pedido (para ajustar los tiempos)
      if (b.action === "log") {
        const done = Number(b.done) || now;
        const day = new Date(done - 3 * 3600 * 1000).toISOString().slice(0, 10); // día de Argentina
        const rec = {
          order: clean(b.order, 20), code: digits(b.code, 6), channel: clean(b.channel, 30),
          products: clean(b.products, 300), category: clean(b.category, 40),
          printed: Number(b.printed) || 0, done, minutes: Number(b.minutes) || 0,
          ideal: Number(b.ideal) || 0, max: Number(b.max) || 0,
        };
        await store.setJSON(`l/${day}/${done}-${rec.order || Math.random().toString(36).slice(2, 7)}`, rec);
        return reply(200, { ok: true });
      }

      const entry = {
        order: clean(b.order, 20),
        name: normName(b.name),
        code: digits(b.code, 6),
        count: Math.max(1, Math.min(9, Number(b.count) || 1)),
        channel: clean(b.channel, 30),
        status: b.status === "cancelled" ? "cancelled" : (b.status === "reminder" ? "reminder" : "ready"),
        at: now,
      };
      if (!entry.order && !entry.code) return reply(400, { ok: false, error: "Falta el pedido" });

      const rnd = Math.random().toString(36).slice(2, 7);
      if (entry.status === "ready") await store.setJSON(`r/${now}-${rnd}`, entry);
      if (entry.code && entry.status !== "reminder") await store.setJSON(`c/${now}-${entry.code}`, entry);
      let pushes = 0;
      try { pushes = await sendPushes(store, entry); } catch (e) { console.warn("Notificaciones:", e && e.message); }
      try { await prune(store, now); } catch (e) { console.warn("No se pudo limpiar:", e && e.message); }
      return reply(200, { ok: true, notificaciones: pushes });
    }

    if (event.httpMethod !== "GET") return reply(405, { ok: false, error: "Método no permitido" });

    const q = event.queryStringParameters || {};

    // ───── ¿Pedidos web en pausa? ─────
    if (q.estado) {
      const cfg = await store.get("cfg/paused", { type: "json" });
      return reply(200, { ok: true, paused: !!(cfg && cfg.paused) }, 5);
    }

    // ───── Registro de tiempos de un día (CSV) ─────
    if (q.registro) {
      if (!process.env.LISTOS_KEY || q.clave !== process.env.LISTOS_KEY) return reply(401, { ok: false, error: "Clave incorrecta" });
      const day = String(q.registro).replace(/[^\d-]/g, "").slice(0, 10);
      const { blobs } = await store.list({ prefix: `l/${day}/` });
      const rows = ["pedido;codigo;canal;categoria;productos;entro;listo;minutos;ideal;maximo"];
      const hm = (ms) => ms ? new Date(ms - 3 * 3600 * 1000).toISOString().slice(11, 16) : "";
      for (const bl of blobs.slice(0, 2000)) {
        const r = await store.get(bl.key, { type: "json" });
        if (!r) continue;
        rows.push([r.order, r.code, r.channel, r.category, `"${String(r.products).replace(/"/g, "'")}"`, hm(r.printed), hm(r.done), r.minutes, r.ideal, r.max].join(";"));
      }
      return { statusCode: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tiempos-${day}.csv"` }, body: "\ufeff" + rows.join("\n") };
    }

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
      // Hora estimada que calcula el KDS (solo si es reciente)
      let eta = [];
      try {
        const etas = await store.get("eta/actual", { type: "json" });
        if (etas && now - etas.at < 5 * 60 * 1000) eta = (etas.items || []).filter((x) => x.code === code).map((x) => ({ name: x.name, eta: x.eta }));
      } catch (e) {}
      return reply(200, { ok: true, ready: list, eta }, 2);
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
