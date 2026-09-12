// netlify/functions/mp-webhook.js
//
// Mercado Pago llama a esta función automáticamente cada vez que
// cambia el estado de un pago. Si el pago está aprobado, arma el
// pedido en el formato que pide Thinkion y lo manda a la API de
// ventas (/order/set/).

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

const THINKION_NODE = process.env.THINKION_NODE; // "1"
const THINKION_CLIENT_CODE = process.env.THINKION_CLIENT_CODE; // "papi"
const THINKION_TOKEN = process.env.THINKION_TOKEN; // token del endpoint de ventas
const THINKION_URL = `https://s${THINKION_NODE}.${THINKION_CLIENT_CODE}.thinkerp.cc/order/set/`;

// id_payment de "Mercado Pago" dentro de Thinkion (tabla payment_method, fila id=15)
const ID_PAYMENT_MERCADO_PAGO = 15;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Método no permitido" };
  }

  try {
    const query = event.queryStringParameters || {};
    const notification = JSON.parse(event.body || "{}");

    // Mercado Pago manda distintos formatos de notificación; nos interesa
    // el tipo "payment", ya sea por query string o por el body.
    const topic = query.topic || query.type || notification.type;
    const paymentId = query.id || query["data.id"] || notification.data?.id;

    if (topic !== "payment" || !paymentId) {
      // Ignoramos notificaciones que no son de pago (ej: merchant_order)
      return { statusCode: 200, body: "ignorado" };
    }

    // 1. Consultamos el pago real a la API de Mercado Pago
    // (nunca confiar ciegamente en el contenido de la notificación)
    const paymentResp = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }
    );
    const payment = await paymentResp.json();

    if (!paymentResp.ok) {
      console.error("No se pudo consultar el pago:", payment);
      return { statusCode: 200, body: "error consultando pago" };
    }

    // 2. Si no está aprobado, no hacemos nada todavía
    if (payment.status !== "approved") {
      return { statusCode: 200, body: `pago en estado ${payment.status}, no se procesa` };
    }

    // 3. Recuperamos los datos del pedido que guardamos en el paso 1
    const metadata = payment.metadata || {};
    const cart = metadata.cart || [];

    if (cart.length === 0) {
      console.error("El pago no tiene carrito asociado en metadata:", payment.id);
      return { statusCode: 200, body: "sin carrito, no se puede armar el pedido" };
    }

    // 4. Armamos los items en el formato que pide Thinkion
    const thinkionItems = cart.map((it, index) => ({
      id_item: index + 1,
      id_product: it.id_product,
      id_parent: 0,
      name: it.name,
      amount: it.quantity,
      price: Number(it.unit_price),
      notes: it.notes || "",
      ordering: index,
    }));

    const total = payment.transaction_amount;

    // 5. Armamos el pedido completo
    const order = {
      details: {
        id_order: payment.id, // usamos el ID del pago de MP: único y trazable
        sale_channel: "digital",
        notes: metadata.notes_general || "",
        total: {
          debt: total,
          discount: 0,
        },
      },
      customer: {
        id_customer: 1, // sin sistema de clientes propio todavía, usamos un ID fijo
        name: metadata.customer_name || "Cliente",
        surname: "",
        email: payment.payer?.email || "sin-email@soypapina.com",
        tel: metadata.customer_tel || null,
        doc: null,
        company: null,
        address: {
          input: "Doña Papina - Salón",
          route: "-",
          number: 0,
          department: null,
          locality: "-",
          city: "-",
          country: "Argentina",
          coords: { lat: 0, lng: 0 },
        },
      },
      items: thinkionItems,
      discounts: [],
      payments: [
        {
          id_payment: ID_PAYMENT_MERCADO_PAGO,
          name: "Mercado Pago",
          total: total,
        },
      ],
    };

    // 6. Mandamos el pedido a Thinkion (espera un ARRAY de pedidos)
    const thinkionResp = await fetch(THINKION_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Server-Token": THINKION_TOKEN,
      },
      body: JSON.stringify([order]),
    });

    const thinkionData = await thinkionResp.json();

    if (!thinkionResp.ok || thinkionData.result === false) {
      console.error("Thinkion rechazó el pedido:", thinkionData);
      // Importante: no perdemos el pedido. Queda el log de Netlify Functions
      // con el detalle para poder reintentar a mano si hace falta.
      return { statusCode: 200, body: JSON.stringify({ warning: "Thinkion rechazó el pedido", detail: thinkionData }) };
    }

    console.log("Pedido cargado en Thinkion OK:", thinkionData);
    return { statusCode: 200, body: JSON.stringify({ ok: true, thinkion: thinkionData }) };
  } catch (err) {
    console.error("Error inesperado en webhook:", err);
    return { statusCode: 200, body: "error interno" };
  }
};
