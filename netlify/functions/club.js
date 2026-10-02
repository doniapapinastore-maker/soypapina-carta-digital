// netlify/functions/club.js
//
// "Sumate al Club Doña Papina": recibe el formulario de la carta (o de /club)
// y lo guarda en la pestaña "Clientes" del sheet, a través del Apps Script de clientes.
//
// Variables en Netlify: CLIENTES_URL (dirección del Apps Script) y CLIENTES_KEY (su clave).

const clean = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Método no permitido" });
  let b = {};
  try { b = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { ok: false, error: "Datos inválidos" }); }

  const telefono = String(b.telefono || "").replace(/\D/g, "");
  if (telefono.length < 8 || telefono.length > 13) return json(400, { ok: false, error: "Revisá el teléfono: tiene que tener entre 8 y 13 números." });
  const nombre = clean(b.nombre, 60);
  if (!nombre) return json(400, { ok: false, error: "Escribí tu nombre." });
  const cumple = clean(b.cumple, 10);
  if (cumple && !/^\d{1,2}\/\d{1,2}$/.test(cumple)) return json(400, { ok: false, error: "El cumpleaños va como día/mes, por ejemplo 23/07." });
  const mail = clean(b.mail, 80);
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return json(400, { ok: false, error: "Revisá el mail." });

  const url = process.env.CLIENTES_URL, key = process.env.CLIENTES_KEY;
  if (!url || !key) return json(500, { ok: false, error: "El Club todavía no está configurado." });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ clave: key, accion: "club", telefono, nombre, cumple, mail, barrio: clean(b.barrio, 60), promos: !!b.promos }),
      redirect: "follow",
      signal: controller.signal,
    });
    const d = await resp.json().catch(() => null);
    if (!d || !d.ok) return json(502, { ok: false, error: "No pudimos guardar tus datos. Probá de nuevo en un rato." });
    return json(200, { ok: true, nuevo: !!d.nuevo });
  } catch (err) {
    console.error("Club:", err && err.message);
    return json(502, { ok: false, error: "No pudimos guardar tus datos. Probá de nuevo en un rato." });
  } finally {
    clearTimeout(timer);
  }
};
