// netlify/functions/mp-webhook.js
//
// Mercado Pago llama a esta función automáticamente cada vez que cambia el
// estado de un pago. Si el pago está aprobado, arma el pedido en el formato
// que pide Thinkion (hamburguesa + opciones como ítems hijos, y el descuento
// si el cliente usó un código) y lo manda a la API de ventas (/order/set/).
//
// CÓMO SE PROTEGE EL PEDIDO:
//  - Solo se da por cargado si Thinkion lo CONFIRMA (el id del pedido tiene que
//    volver en la lista "confirm"). Que responda "result: true" no alcanza.
//  - Si Thinkion no confirma, esta función responde con error (500) y Mercado
//    Pago vuelve a avisar solo, varias veces. Thinkion evita duplicados porque
//    el id del pedido es siempre el id del pago.

const { CATALOG, expandCart, buildThinkionOrder, sendToThinkion } = require("./menu");

// id_payment de "Mercado Pago" dentro de Thinkion (tabla payment_method, fila id=15)
const ID_PAYMENT_MERCADO_PAGO = 15;

const ok = (msg) => ({ statusCode: 200, body: typeof msg === "string" ? msg : JSON.stringify(msg) });
// Con 500 Mercado Pago reintenta el aviso más tarde.
const retry = (msg) => ({ statusCode: 500, body: typeof msg === "string" ? msg : JSON.stringify(msg) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Método no permitido" };
  }

  try {
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const query = event.queryStringParameters || {};
    let notification = {};
    try {
      notification = JSON.parse(event.body || "{}");
    } catch (e) {
      notification = {};
    }

    // Mercado Pago manda distintos formatos de notificación; nos interesa
    // el tipo "payment", ya sea por query string o por el body.
    const topic = query.topic || query.type || notification.type;
    const paymentId = query.id || query["data.id"] || (notification.data && notification.data.id);

    if (topic !== "payment" || !paymentId) {
      // Ignoramos notificaciones que no son de pago (ej: merchant_order)
      return ok("ignorado");
    }

    // 1. Consultamos el pago real a la API de Mercado Pago
    //    (nunca confiar ciegamente en el contenido de la notificación)
    const paymentResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const payment = await paymentResp.json();

    if (!paymentResp.ok) {
      console.error("No se pudo consultar el pago:", paymentId, payment);
      return retry("error consultando pago"); // que Mercado Pago reintente
    }

    // 2. Si no está aprobado, no hacemos nada todavía
    if (payment.status !== "approved") {
      return ok(`pago en estado ${payment.status}, no se procesa`);
    }

    // 3. Recuperamos el pedido que guardamos al crear el pago
    const metadata = payment.metadata || {};
    const norm = expandCart(metadata.cart);
    if (!norm.ok) {
      // Un reintento no arregla esto: queda el aviso en el log para resolverlo a mano.
      console.error(
        `PAGO APROBADO SIN PEDIDO VÁLIDO (id_pago ${payment.id}, cliente ${metadata.customer_name}, $${payment.transaction_amount}):`,
        norm.error,
        JSON.stringify(metadata.cart)
      );
      return ok("pedido no válido, ver log");
    }

    // 4. Importes. Lo cobrado es lo que dice Mercado Pago; el descuento es la diferencia
    //    contra el total del catálogo (solo si el cliente usó un código válido).
    const paid = Number(payment.transaction_amount);
    let discount = null;
    const dKey = metadata.discount_key;
    if (dKey && Object.prototype.hasOwnProperty.call(CATALOG.discounts, dKey)) {
      const d = CATALOG.discounts[dKey];
      const amount = norm.total - paid;
      if (amount > 0) {
        discount = { id: d.id, name: d.name, amount, code: String(metadata.coupon || "") };
      } else {
        console.warn(`Pago con código pero sin diferencia de importe (id_pago ${payment.id}): total ${norm.total}, cobrado ${paid}`);
      }
      if (metadata.expected_pay != null && Number(metadata.expected_pay) !== paid) {
        console.warn(`Lo cobrado ($${paid}) no coincide con lo esperado ($${metadata.expected_pay}). id_pago ${payment.id}`);
      }
    } else if (paid !== norm.total) {
      console.warn(`El total pagado ($${paid}) no coincide con el del catálogo ($${norm.total}). id_pago ${payment.id}`);
    }

    // 5. Armamos el pedido completo para Thinkion
    const orderId = Number(payment.id); // id del pago de MP: único y trazable
    const order = buildThinkionOrder({
      orderId,
      name: metadata.customer_name,
      email: payment.payer && payment.payer.email,
      generalNotes: metadata.notes_general,
      lines: norm.lines,
      debt: paid,
      discount,
      payment: { id_payment: ID_PAYMENT_MERCADO_PAGO, name: "Mercado Pago", total: paid },
    });

    // 6. Mandamos el pedido a Thinkion y exigimos su confirmación
    let result;
    try {
      result = await sendToThinkion(order);
    } catch (err) {
      console.error(`Thinkion no respondió (id_pago ${payment.id}):`, err && err.message);
      return retry("Thinkion no respondió, se reintenta");
    }

    if (!result.confirmed) {
      console.error(
        `Thinkion NO confirmó el pedido (id_pago ${payment.id}, http ${result.status}):`,
        JSON.stringify(result.data)
      );
      return retry("Thinkion no confirmó el pedido, se reintenta");
    }

    console.log(`Pedido ${orderId} cargado y confirmado en Thinkion`);
    return ok({ ok: true, id_order: orderId });
  } catch (err) {
    console.error("Error inesperado en webhook:", err);
    return retry("error interno, se reintenta");
  }
};
