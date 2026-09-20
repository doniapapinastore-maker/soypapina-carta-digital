// netlify/functions/coupon.js
//
// La carta llama a esta función cuando el cliente escribe un código de descuento
// y toca "Aplicar". Solo dice si el código sirve y qué descuento da.
// Los códigos y descuentos viven en menu.js (no se pueden ver desde el celular).

const { resolveCoupon } = require("./menu");

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Método no permitido" };
  }
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { ok: false, error: "Pedido inválido" });
  }

  const c = resolveCoupon(body.code);
  if (!c.ok) {
    await sleep(600); // frena un poco a quien prueba códigos al azar
    return json(404, { ok: false, error: c.error });
  }
  return json(200, { ok: true, code: c.code, name: c.name, percent: c.percent });
};
