// netlify/functions/coupon.js
//
// La carta pregunta acá si un código de descuento es válido antes de pagar.
// Los códigos, su porcentaje, vencimiento y cantidad de usos se manejan en la
// pestaña "Descuentos" del archivo "Doña Papina · Clientes y Banda".
// Responde: 200 { ok, code, name, percent } · 404 { ok:false, error } · 503 si la planilla no respondió.

const { resolverCodigo } = require("./menu");

const json = (code, body) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Método no permitido" });
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { body = {}; }
  const r = await resolverCodigo(body.code);
  if (!r.ok) return json(r.retry ? 503 : 404, { ok: false, error: r.error });
  return json(200, { ok: true, code: r.code, name: r.name, percent: r.percent });
};
