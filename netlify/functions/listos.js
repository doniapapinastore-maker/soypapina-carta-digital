// netlify/functions/listos.js
//
// "Pedido listo": une el KDS de la cocina con la carta.
//
//  POST (lo llama el KDS al tocar "Listo"):
//     header X-Server-Token = clave de avisos (variable LISTOS_KEY en Netlify)
//     body { order, name, code, channel }
//  GET ?code=4821   → el celular del cliente pregunta si SU pedido ya está listo
//  GET (sin código) → la pantalla del salón pide los últimos pedidos listos
//
// Los datos se guardan en Netlify Blobs (almacenamiento de Netlify, sin base de datos).
// Se borran solos a las 3 horas.

const { getStore, connectLambda } = require("@netlify/blobs");

const KEEP_MS = 3 * 60 * 60 * 1000;   // se guardan 3 horas
const SALON_MS = 20 * 60 * 1000;      // la pantalla del salón muestra los últimos 20 minutos
const SALON_MAX = 12;

const clean = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

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

async function prune(store, now) {
  const { blobs } = await store.list();
  const old = blobs.filter((b) => {
    const m = /^(?:r|c)\/(\d+)/.exec(b.key);
    const at = m ? Number(m[1]) : 0;
    return !at || now - at > KEEP_MS;
  });
  await Promise.all(old.slice(0, 50).map((b) => store.delete(b.key)));
}

exports.handler = async (event) => {
  try {
    const store = openStore(event);
    const now = Date.now();

    // ───── El KDS avisa que un pedido está listo ─────
    if (event.httpMethod === "POST") {
      const key = process.env.LISTOS_KEY;
      const sent = (event.headers && (event.headers["x-server-token"] || event.headers["X-Server-Token"])) || "";
      if (!key || sent !== key) return reply(401, { ok: false, error: "Clave de avisos incorrecta" });

      let b = {};
      try { b = JSON.parse(event.body || "{}"); } catch (e) { b = {}; }
      const entry = {
        order: clean(b.order, 20),
        name: clean(b.name, 60).toUpperCase(),
        code: clean(b.code, 6).replace(/\D/g, ""),
        channel: clean(b.channel, 30),
        at: now,
      };
      if (!entry.order && !entry.code) return reply(400, { ok: false, error: "Falta el pedido" });

      const rnd = Math.random().toString(36).slice(2, 7);
      await store.setJSON(`r/${now}-${rnd}`, entry);
      if (entry.code) await store.setJSON(`c/${now}-${entry.code}`, entry);
      try { await prune(store, now); } catch (e) { console.warn("No se pudo limpiar:", e && e.message); }
      return reply(200, { ok: true });
    }

    if (event.httpMethod !== "GET") return reply(405, { ok: false, error: "Método no permitido" });

    const q = event.queryStringParameters || {};

    // ───── El celular del cliente pregunta por su código ─────
    if (q.code) {
      const code = String(q.code).replace(/\D/g, "").slice(0, 6);
      const { blobs } = await store.list({ prefix: "c/" });
      const mine = blobs
        .map((b) => { const m = /^c\/(\d+)-(\d+)$/.exec(b.key); return m ? { key: b.key, at: Number(m[1]), code: m[2] } : null; })
        .filter((x) => x && x.code === code && now - x.at < KEEP_MS)
        .sort((a, b) => b.at - a.at);
      const list = [];
      for (const x of mine.slice(0, 5)) {
        const e = await store.get(x.key, { type: "json" });
        if (e) list.push({ name: e.name, at: e.at });
      }
      return reply(200, { ok: true, ready: list }, 5);
    }

    // ───── La pantalla del salón pide los últimos listos ─────
    const { blobs } = await store.list({ prefix: "r/" });
    const recent = blobs
      .map((b) => { const m = /^r\/(\d+)-/.exec(b.key); return m ? { key: b.key, at: Number(m[1]) } : null; })
      .filter((x) => x && now - x.at < SALON_MS)
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
