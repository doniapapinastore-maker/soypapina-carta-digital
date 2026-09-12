// netlify/functions/create-preference.js
//
// Recibe el carrito armado por el cliente en la carta digital y crea
// una "preferencia de pago" en Mercado Pago. Devuelve el link de pago
// (init_point) al que hay que redirigir al cliente.
//
// El ACCESS TOKEN de Mercado Pago NUNCA va en el código: se lee desde
// una variable de entorno configurada en Netlify (ver instrucciones).

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SITE_URL = process.env.SITE_URL || "https://soypapina.netlify.app";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Método no permitido" };
  }

  try {
    const body = JSON.parse(event.body);
    // body esperado (lo arma el frontend):
    // {
    //   items: [{ name, quantity, unit_price, notes }],
    //   customer: { name, tel, notes_general },
    //   total: 34500
    // }

    const { items, customer, total } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Carrito vacío" }) };
    }

    // Armamos los items en el formato que pide Mercado Pago
    const mpItems = items.map((it) => ({
      title: it.name,
      quantity: it.quantity,
      unit_price: Number(it.unit_price),
      currency_id: "ARS",
    }));

    // Guardamos en metadata TODO lo que vamos a necesitar después,
    // cuando llegue la confirmación de pago (webhook), para armar
    // el pedido en Thinkion sin depender de ninguna base de datos.
    const metadata = {
      customer_name: customer?.name || "Cliente",
      customer_tel: customer?.tel || "",
      notes_general: customer?.notes_general || "",
      cart: items, // guardamos el carrito completo (incluye id_product de cada ítem)
    };

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
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No se pudo crear el pago", detail: data }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        init_point: data.init_point, // link al que hay que mandar al cliente
        preference_id: data.id,
      }),
    };
  } catch (err) {
    console.error("Error inesperado:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Error interno" }) };
  }
};
