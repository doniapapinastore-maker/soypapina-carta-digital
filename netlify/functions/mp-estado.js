// netlify/functions/mp-estado.js
//
// La carta pregunta acá si un pedido ya se pagó, usando la marca única del pago
// (external_reference = "dp_..."). Sirve para cuando el cliente paga desde la app
// de Mercado Pago y no vuelve solo a soypapina.com.ar: al volver a entrar, la carta
// consulta y le muestra su comprobante con el código de retiro.
//
// La clave de Mercado Pago (MP_ACCESS_TOKEN) se usa solo acá, nunca en el celular.
// Devuelve: { ok: true, status: "approved" | "pending" | "rejected" | "none", payment_id }

const json = (code, body) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

// Resumen del pedido (nombre, detalle, total) guardado antes de ir a pagar.
// Sirve cuando Mercado Pago devuelve al cliente en otro navegador (el de su app) que no tiene la memoria del celular.
function tienda(event) {
  try { const { getStore, connectLambda } = require("@netlify/blobs"); try { connectLambda(event); } catch (e) {} return getStore("listos"); } catch (e) { return null; }
}
const REF_OK = /^dp_[a-z0-9]{4,20}_[a-z0-9]{2,12}$/;

exports.handler = async (event) => {
  // Guardar el resumen (lo manda la carta justo antes de ir a Mercado Pago)
  if (event.httpMethod === "POST") {
    let b = {}; try { b = JSON.parse(event.body || "{}"); } catch (e) { b = {}; }
    const r = String(b.ref || "");
    const txt = JSON.stringify(b.pedido || null);
    if (!REF_OK.test(r) || !b.pedido || txt.length > 12000) return json(400, { ok: false });
    const st = tienda(event); if (!st) return json(500, { ok: false });
    if (await st.get("resumen/" + r)) return json(200, { ok: true });   // no se pisa
    await st.setJSON("resumen/" + r, { at: Date.now(), pedido: b.pedido });
    return json(200, { ok: true });
  }
  if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Método no permitido" });
  const ref = String((event.queryStringParameters || {}).ref || "");
  if (!REF_OK.test(ref)) return json(400, { ok: false, error: "Referencia inválida" });
  let resumen = null;
  try { const st = tienda(event); const x = st && (await st.get("resumen/" + ref, { type: "json" })); if (x && Date.now() - x.at < 2 * 86400000) resumen = x.pedido; } catch (e) {}

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return json(500, { ok: false, error: "Falta MP_ACCESS_TOKEN" });

  try {
    const url = "https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=10&external_reference=" + encodeURIComponent(ref);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) {
      console.error("mp-estado: Mercado Pago respondió", r.status);
      return json(502, { ok: false, error: "No pudimos consultar a Mercado Pago", resumen });
    }
    const data = await r.json();
    const pagos = Array.isArray(data.results) ? data.results.filter((p) => p && p.external_reference === ref) : [];
    if (!pagos.length) return json(200, { ok: true, status: "none", resumen });
    const aprobado = pagos.find((p) => p.status === "approved");
    if (aprobado) return json(200, { ok: true, status: "approved", payment_id: String(aprobado.id), resumen });
    const pendiente = pagos.find((p) => p.status === "pending" || p.status === "in_process" || p.status === "authorized");
    if (pendiente) return json(200, { ok: true, status: "pending", payment_id: String(pendiente.id), resumen });
    return json(200, { ok: true, status: "rejected", payment_id: String(pagos[0].id), resumen });
  } catch (err) {
    console.error("mp-estado:", err && err.message);
    return json(502, { ok: false, error: "No pudimos consultar a Mercado Pago", resumen });
  }
};
