// netlify/functions/create-preference.js
//
// Recibe lo que el cliente ARMÓ en la carta (qué hamburguesa, con qué pan,
// papas, salsa, aderezos y bebida, y si tiene un código de descuento) y:
//
//   • Si queda algo para pagar: crea el pago en Mercado Pago por el IMPORTE
//     RESTANTE y devuelve el link (init_point) al que hay que mandar al cliente.
//   • Si el descuento es del 100% ("Invita la casa"): no pasa por Mercado Pago.
//     Carga el pedido directo en Thinkion y devuelve { free: true }.
//
// IMPORTANTE: el celular NO manda precios ni montos. Los precios, el descuento y
// el total se calculan acá, con el catálogo de menu.js, para que nadie pueda alterarlos.
//
// El ACCESS TOKEN de Mercado Pago NUNCA va en el código: se lee de una
// variable de entorno configurada en Netlify (MP_ACCESS_TOKEN).

const {
  CATALOG,
  cleanText,
  normalizeLines,
  compactCart,
  resolveCoupon,
  applyDiscount,
  buildThinkionOrder,
  sendToThinkion,
  freeOrderId,
} = require("./menu");

const SITE_URL = process.env.SITE_URL || "https://soypapina.com.ar";

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Método no permitido" };
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return json(400, { error: "Pedido inválido" });
    }

    // body esperado (lo arma la carta):
    // {
    //   customer: { name, notes_general },
    //   pickup: true,                       // el cliente confirmó que retira en el local
    //   coupon: "PRUEBA10",                 // opcional
    //   lines: [{ key, bread, fries, sauce, extras: [], drink, note }]
    // }
    const customer = body.customer || {};
    const name = cleanText(customer.name, 60);
    if (!name) return json(400, { error: "Falta el nombre" });
    if (body.pickup !== true) {
      return json(400, { error: "Falta confirmar el retiro en el local" });
    }

    // Validamos el pedido y calculamos el total con el catálogo del servidor
    const norm = normalizeLines(body.lines);
    if (!norm.ok) return json(400, { error: norm.error });

    // Código de descuento (opcional)
    let coupon = null;
    if (body.coupon) {
      coupon = resolveCoupon(body.coupon);
      if (!coupon.ok) return json(400, { error: coupon.error, coupon_invalid: true });
    }
    const pricing = applyDiscount(norm.total, coupon ? coupon.percent : 0);
    const generalNotes = cleanText(customer.notes_general, 300);

    // ───── 100% de descuento: no hay nada para cobrar, va directo a Thinkion ─────
    if (pricing.pay <= 0) {
      const orderId = freeOrderId();
      const order = buildThinkionOrder({
        orderId,
        name,
        email: null,
        generalNotes,
        lines: norm.lines,
        debt: 0,
        discount: { id: coupon.id, name: coupon.name, amount: pricing.discount, code: coupon.code },
        payment: null,
      });

      let result;
      try {
        result = await sendToThinkion(order);
      } catch (err) {
        console.error(`PEDIDO SIN COSTO: Thinkion no respondió (id ${orderId}, ${name}):`, err && err.message);
        return json(502, { error: "No pudimos registrar tu pedido. Probá de nuevo en unos segundos." });
      }
      if (!result.confirmed) {
        console.error(`PEDIDO SIN COSTO: Thinkion NO confirmó (id ${orderId}, http ${result.status}):`, JSON.stringify(result.data));
        return json(502, { error: "No pudimos registrar tu pedido. Probá de nuevo en unos segundos." });
      }
      console.log(`Pedido sin costo ${orderId} cargado y confirmado en Thinkion (código ${coupon.code})`);
      return json(200, {
        free: true,
        order_id: orderId,
        subtotal: pricing.subtotal,
        discount: pricing.discount,
        total: 0,
      });
    }

    // ───── Hay algo para pagar: Mercado Pago ─────
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!MP_ACCESS_TOKEN) {
      console.error("Falta la variable MP_ACCESS_TOKEN en Netlify");
      return json(500, { error: "Pagos no configurados" });
    }

    let mpItems;
    if (coupon) {
      // Con descuento, Mercado Pago cobra UN solo importe: lo que queda por pagar.
      mpItems = [
        {
          id: "pedido",
          title: `Pedido Doña Papina (${coupon.name})`,
          quantity: 1,
          unit_price: pricing.pay,
          currency_id: "ARS",
        },
      ];
    } else {
      // Sin descuento: una fila por tipo de hamburguesa (con su cantidad).
      // Las opciones (pan, papas, etc.) van a $0 y solo viajan a Thinkion.
      const counts = {};
      for (const l of norm.lines) counts[l.key] = (counts[l.key] || 0) + 1;
      mpItems = Object.keys(counts).map((key) => ({
        id: key,
        title: CATALOG.products[key].name,
        quantity: counts[key],
        unit_price: CATALOG.products[key].price,
        currency_id: "ARS",
      }));
    }

    // Guardamos el pedido (compacto) en metadata para armarlo en Thinkion
    // cuando llegue la confirmación de pago (webhook).
    const metadata = {
      customer_name: name,
      notes_general: generalNotes,
      cart: compactCart(norm.lines),
    };
    if (coupon) {
      metadata.coupon = coupon.code;
      metadata.discount_key = coupon.key;
      metadata.expected_pay = pricing.pay;
    }

    const preference = {
      items: mpItems,
      metadata,
      back_urls: {
        success: `${SITE_URL}/?pago=exito`,
        failure: `${SITE_URL}/?pago=fallo`,
        pending: `${SITE_URL}/?pago=pendiente`,
      },
      auto_return: "approved",
      notification_url: `${SITE_URL}/.netlify/functions/mp-webhook`,
    };

    const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preference),
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error("Error creando preferencia MP:", data);
      return json(500, { error: "No se pudo crear el pago" });
    }

    // Con credenciales de PRUEBA (empiezan con "TEST-") hay que ir al link de
    // sandbox; con las de producción, al link normal.
    const isTestCredential = MP_ACCESS_TOKEN.startsWith("TEST-");
    const checkoutUrl = isTestCredential ? data.sandbox_init_point || data.init_point : data.init_point;

    return json(200, {
      init_point: checkoutUrl,
      preference_id: data.id,
      subtotal: pricing.subtotal,
      discount: pricing.discount,
      total: pricing.pay,
    });
  } catch (err) {
    console.error("Error inesperado:", err);
    return json(500, { error: "Error interno" });
  }
};
