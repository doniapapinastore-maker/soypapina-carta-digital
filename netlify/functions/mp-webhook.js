// netlify/functions/mp-webhook.js
//
// Mercado Pago llama a esta función automáticamente cada vez que cambia el
// estado de un pago. Si el pago está aprobado, arma el pedido en el formato
// que pide Thinkion (hamburguesa + opciones como ítems hijos) y lo manda a la
// API de ventas (/order/set/).
//
// CÓMO SE PROTEGE EL PEDIDO:
//  - Solo se da por cargado si Thinkion lo CONFIRMA (el id del pedido tiene que
//    volver en la lista "confirm"). Que responda "result: true" no alcanza.
//  - Si Thinkion no confirma, esta función responde con error (500) y Mercado
//    Pago vuelve a avisar solo, varias veces. Thinkion evita duplicados porque
//    el id del pedido es siempre el id del pago.

const { expandCart, buildThinkionItems, cleanText } = require("./menu");

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const THINKION_NODE = process.env.THINKION_NODE; // "1"
const THINKION_CLIENT_CODE = process.env.THINKION_CLIENT_CODE; // "papi"
const THINKION_TOKEN = process.env.THINKION_TOKEN; // token del endpoint de ventas

const THINKION_URL = `https://s${THINKION_NODE}.${THINKION_CLIENT_CODE}.thinkerp.cc/order/set/`;

// id_payment de "Mercado Pago" dentro de Thinkion (tabla payment_method, fila id=15)
const ID_PAYMENT_MERCADO_PAGO = 15;

const THINKION_TIMEOUT_MS = 8000;

const ok = (msg) => ({ statusCode: 200, body: typeof msg === "string" ? msg : JSON.stringify(msg) });
// Con 500 Mercado Pago reintenta el aviso más tarde.
const retry = (msg) => ({ statusCode: 500, body: typeof msg === "string" ? msg : JSON.stringify(msg) });

async function sendToThinkion(order) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), THINKION_TIMEOUT_MS);
  try {
    const resp = await fetch(THINKION_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Server-Token": THINKION_TOKEN,
      },
      body: JSON.stringify([order]), // Thinkion espera un ARRAY de pedidos
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await resp.json();
    } catch (e) {
      data = null;
    }
    return { httpOk: resp.ok, status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Método no permitido" };
  }

  try {
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

    const total = payment.transaction_amount;
    if (Number(total) !== Number(norm.total)) {
      console.warn(`El total pagado ($${total}) no coincide con el del catálogo ($${norm.total}). id_pago ${payment.id}`);
    }

    // 4. Armamos el pedido completo para Thinkion
    const orderId = Number(payment.id); // id del pago de MP: único y trazable
    const generalNotes = cleanText(metadata.notes_general, 400);
    const order = {
      details: {
        id_order: orderId,
        sale_channel: "digital",
        notes: cleanText(`RETIRA EN EL LOCAL${generalNotes ? " - " + generalNotes : ""}`, 500),
        total: {
          debt: total,
          discount: 0,
        },
      },
      customer: {
        id_customer: 1, // sin sistema de clientes propio todavía, usamos un ID fijo
        name: metadata.customer_name || "Cliente",
        surname: "",
        email: (payment.payer && payment.payer.email) || "sin-email@soypapina.com",
        tel: metadata.customer_tel || null,
        doc: null,
        company: null,
        address: {
          input: "Doña Papina - Retiro en el local",
          route: "-",
          number: 0,
          department: null,
          locality: "-",
          city: "-",
          country: "Argentina",
          coords: { lat: 0, lng: 0 },
        },
      },
      items: buildThinkionItems(norm.lines),
      discounts: [],
      payments: [
        {
          id_payment: ID_PAYMENT_MERCADO_PAGO,
          name: "Mercado Pago",
          total: total,
        },
      ],
    };

    // 5. Mandamos el pedido a Thinkion y exigimos su confirmación
    let result;
    try {
      result = await sendToThinkion(order);
    } catch (err) {
      console.error(`Thinkion no respondió (id_pago ${payment.id}):`, err && err.message);
      return retry("Thinkion no respondió, se reintenta");
    }

    const data = result.data || {};
    const confirmed = Array.isArray(data.confirm) && data.confirm.map(Number).indexOf(orderId) !== -1;

    if (!result.httpOk || data.result !== true || !confirmed) {
      console.error(
        `Thinkion NO confirmó el pedido (id_pago ${payment.id}, http ${result.status}):`,
        JSON.stringify(data)
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
