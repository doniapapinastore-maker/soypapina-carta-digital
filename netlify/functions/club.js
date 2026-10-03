// netlify/functions/club.js
//
// La Banda de Papina. Cuatro usos:
//  • { accion: "encuesta", ... } → respuesta de "¿Cómo nos fue?" (se guarda en la pestaña Encuestas).
//  • GET ?pagina=1 → beneficios, fotos y novedades para soypapina.com.ar/banda (Netlify lo guarda 5 minutos).
//  • { accion: "estado", telefono }  → qué regalos lo esperan y cómo van sus sellos
//    (la carta lo pide cuando el cliente escribe su celu). Sin teléfono, devuelve solo
//    los beneficios activos (para el formulario). Solo lee.
//  • { nombre, telefono, cumple, mail, barrio, promos } → se suma a La Banda
//    (formulario de la carta o de soypapina.com.ar/banda).
// Todo pasa por el Apps Script de clientes, que escribe en la pestaña "Clientes" del sheet.
//
// Variables en Netlify: CLIENTES_URL (dirección del Apps Script) y CLIENTES_KEY (su clave).

const clean = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

async function appsScript(payload, timeoutMs) {
  const url = process.env.CLIENTES_URL, key = process.env.CLIENTES_KEY;
  if (!url || !key) return { configError: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ clave: key }, payload)),
      redirect: "follow",
      signal: controller.signal,
    });
    return (await resp.json().catch(() => null)) || null;
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  // ───── Página soypapina.com.ar/banda: beneficios, fotos y novedades ─────
  // Netlify la guarda 5 minutos, así casi no se usa la función ni el sheet.
  if (event.httpMethod === "GET" && (event.queryStringParameters || {}).pagina) {
    try {
      const d = await appsScript({ accion: "pagina" }, 9000);
      if (!d || !d.ok) return json(502, { ok: false });
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
          "Netlify-CDN-Cache-Control": "public, durable, s-maxage=300, stale-while-revalidate=600",
        },
        body: JSON.stringify(d),
      };
    } catch (err) {
      console.warn("Banda (página):", err && err.message);
      return json(502, { ok: false });
    }
  }
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Método no permitido" });
  let b = {};
  try { b = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { ok: false, error: "Datos inválidos" }); }

  // ───── Estado: qué regalos lo esperan ─────
  if (b.accion === "estado") {
    const telefono = String(b.telefono || "").replace(/\D/g, "");
    try {
      const amigo = String(b.amigo || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20);
      const d = await appsScript({ accion: "estado", telefono: telefono.length >= 8 && telefono.length <= 13 ? telefono : "", amigo }, 7000);
      if (!d || !d.ok) return json(502, { ok: false });
      return json(200, d);
    } catch (err) {
      console.warn("Banda (estado):", err && err.message);
      return json(502, { ok: false });
    }
  }

  // ───── Encuesta "¿Cómo nos fue?" ─────
  if (b.accion === "encuesta") {
    const ok = ["bien", "regular", "mal"];
    if (ok.indexOf(b.resultado) === -1) return json(400, { ok: false });
    const lista = (v, n, max) => (Array.isArray(v) ? v : []).map((x) => clean(x, max)).filter(Boolean).slice(0, n);
    try {
      const d = await appsScript({
        accion: "encuesta", resultado: b.resultado, canal: b.canal === "whatsapp" ? "whatsapp" : "web",
        id: String(b.id || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40),
        codigo: String(b.codigo || "").replace(/\D/g, "").slice(0, 6),
        telefono: String(b.telefono || "").replace(/\D/g, "").slice(0, 13),
        nombre: clean(b.nombre, 60), gusto: clean(b.gusto, 80), comentario: clean(b.comentario, 500),
        problemas: lista(b.problemas, 8, 60), productos: lista(b.productos, 12, 60),
      }, 9000);
      if (!d || !d.ok) return json(502, { ok: false });
      return json(200, { ok: true });
    } catch (err) {
      console.warn("Encuesta:", err && err.message);
      return json(502, { ok: false });
    }
  }

  // ───── Sumarse a La Banda ─────
  const telefono = String(b.telefono || "").replace(/\D/g, "");
  if (telefono.length < 8 || telefono.length > 13) return json(400, { ok: false, error: "Revisá el celu: tiene que tener entre 8 y 13 números." });
  const nombre = clean(b.nombre, 60);
  if (!nombre) return json(400, { ok: false, error: "Escribí tu nombre así Papina sabe quién sos." });
  const cumple = clean(b.cumple, 10);
  if (cumple && !/^\d{1,2}\/\d{1,2}$/.test(cumple)) return json(400, { ok: false, error: "El cumple va como día/mes, por ejemplo 23/07." });
  const mail = clean(b.mail, 80);
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return json(400, { ok: false, error: "Revisá el mail, parece que le falta algo." });

  try {
    const d = await appsScript({ accion: "club", telefono, nombre, cumple, mail, barrio: clean(b.barrio, 60), promos: !!b.promos,
      amigo: String(b.amigo || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20) }, 9000);
    if (d && d.configError) return json(500, { ok: false, error: "La Banda todavía no está configurada." });
    if (!d || !d.ok) return json(502, { ok: false, error: "No pudimos guardar tus datos. Probá de nuevo en un rato." });
    return json(200, { ok: true, nuevo: !!d.nuevo, bienvenidaEntregada: !!d.bienvenidaEntregada });
  } catch (err) {
    console.error("Banda:", err && err.message);
    return json(502, { ok: false, error: "No pudimos guardar tus datos. Probá de nuevo en un rato." });
  }
};
