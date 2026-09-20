// netlify/functions/menu.js
//
// FUENTE ÚNICA de productos, precios y opciones de la carta.
//
//  - La carta (index.html) le pide los precios a esta función cada vez que se abre.
//  - create-preference.js y mp-webhook.js usan este mismo catálogo para calcular
//    el total y armar el pedido, así que el celular del cliente NUNCA decide el precio.
//
// PARA CAMBIAR UN PRECIO: editá el número "price" de la hamburguesa acá abajo,
// subí el archivo a GitHub y esperá el tilde verde en Netlify. Nada más.
//
// (Más adelante estos precios se pueden leer directo de Thinkion, reporte 132.)

const CATALOG = {
  // ─── Hamburguesas ────────────────────────────────────────────────
  // id  = id_product en Thinkion
  // price = precio en pesos (PRECIOS DE REFERENCIA, cambiar por los reales)
  // bread / fries = si esa hamburguesa lleva elección de pan / papas
  // available = poné false para mostrarla como "Agotada" y que no se pueda pedir
  products: {
    ldv: { id: 1,   code: "LDV", name: "La Doble Vida",      price: 24000, bread: true,  fries: true,  available: true },
    hdp: { id: 132, code: "HDP", name: "Hambre De Papina",   price: 19000, bread: true,  fries: true,  available: true },
    tmb: { id: 134, code: "TMB", name: "Tenés Mucho Bacon",  price: 21000, bread: true,  fries: true,  available: true },
    qlp: { id: 135, code: "QLP", name: "Qué Locura, Papina", price: 26000, bread: true,  fries: true,  available: true },
    lp:  { id: 136, code: "LP",  name: "La Pecadora",        price: 22000, bread: true,  fries: true,  available: true },
    lt:  { id: 137, code: "LT",  name: "La Traicionera",     price: 27000, bread: true,  fries: true,  available: true },
    lc:  { id: 138, code: "LC",  name: "La Consentida",      price: 20000, bread: true,  fries: true,  available: true },
    lm:  { id: 139, code: "LM",  name: "La Malcriada",       price: 25000, bread: true,  fries: true,  available: true },
    lfs: { id: 140, code: "LFS", name: "La Falsa Sana",      price: 20000, bread: true,  fries: true,  available: true },
    // Los chiquitos
    pn:  { id: 141, code: "PN",  name: "Papinuggets",        price: 19000, bread: false, fries: false, available: true },
    lpp: { id: 142, code: "LPP", name: "La Pequeña Papina",  price: 19000, bread: true,  fries: true,  available: true },
    ltp: { id: 143, code: "LTP", name: "La Traviesa Papina", price: 19000, bread: true,  fries: true,  available: true },
  },

  // ─── Opciones (van a Thinkion como productos "hijos", a $0) ──────
  // label = texto completo (resumen y comprobante) · short = texto del botón
  bread: [
    { key: "pan_papa",           id: 148, name: "PAN DE PAPA CLASICO",       label: "Pan de papa",                short: "Pan de papa" },
    { key: "pan_papa_semillas",  id: 149, name: "PAN DE PAPA CON SEMILLAS",  label: "Pan de papa con semillas",   short: "Pan de papa con semillas" },
    { key: "pan_papa_parmesano", id: 150, name: "PAN DE PAPA CON PARMESANO", label: "Pan de papa con parmesano",  short: "Pan de papa con parmesano" },
    { key: "pan_clasico",          id: 146, name: "PAN CLASICO",               label: "Pan clásico",              short: "Pan clásico" },
    { key: "pan_clasico_semillas", id: 147, name: "PAN CLASICO CON SEMILLAS",  label: "Pan clásico con semillas", short: "Pan clásico con semillas" },
  ],
  fries: [
    { key: "sazonadas", id: 144, name: "PAPAS REGULARES SAZONADAS", label: "Papas sazonadas", short: "Sazonadas", default: true },
    { key: "clasicas",  id: 145, name: "PAPAS REGULARES CLASICAS",  label: "Papas clásicas",  short: "Clásicas" },
  ],
  sauce: [
    { key: "tasty", id: 151, name: "SALSA TASTY",         label: "Salsa Tasty", short: "Tasty", default: true },
    { key: "honey", id: 152, name: "SALSA HONEY",         label: "Salsa Honey", short: "Honey" },
    { key: "bbq",   id: 153, name: "SALSA BBQ - BARBECUE", label: "Salsa BBQ",  short: "BBQ" },
  ],
  extras: [
    { key: "mayonesa", id: 154, name: "MAYONESA", label: "Mayonesa", short: "Mayonesa" },
    { key: "mostaza",  id: 155, name: "MOSTAZA",  label: "Mostaza",  short: "Mostaza" },
    { key: "ketchup",  id: 156, name: "KETCHUP",  label: "Ketchup",  short: "Ketchup" },
  ],
  drinks: [
    { key: "agua_sin_gas", id: 8,   name: "AGUA SIN GAS",             label: "Agua sin gas",               short: "Agua sin gas" },
    { key: "agua_con_gas", id: 4,   name: "AGUA CON GAS",             label: "Agua con gas",               short: "Agua con gas" },
    { key: "sab_manzana",  id: 5,   name: "AGUA SABORIZADA MANZANA",  label: "Agua saborizada de manzana", short: "Agua saborizada de manzana" },
    { key: "sab_pomelo",   id: 7,   name: "AGUA SABORIZADA POMELO",   label: "Agua saborizada de pomelo",  short: "Agua saborizada de pomelo" },
    { key: "coca_500",     id: 32,  name: "COCA COLA 500",            label: "Coca-Cola 500",              short: "Coca-Cola 500" },
    { key: "sevenup_500",  id: 116, name: "7 UP 500",                 label: "7up 500",                    short: "7up 500" },
  ],
};

const MAX_LINES = 20; // hamburguesas por pedido

const byKey = (list) => Object.fromEntries(list.map((o) => [o.key, o]));
const MAPS = {
  bread: byKey(CATALOG.bread),
  fries: byKey(CATALOG.fries),
  sauce: byKey(CATALOG.sauce),
  extras: byKey(CATALOG.extras),
  drinks: byKey(CATALOG.drinks),
};

const fail = (error) => ({ ok: false, error });

function cleanText(v, max) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
}

// Valida lo que mandó el celular y lo deja en forma "limpia".
// Devuelve { ok:true, lines, total } o { ok:false, error }.
// opts.skipAvailability: lo usa el webhook, porque un pedido YA PAGADO se carga
// en Thinkion aunque después el producto se haya marcado como agotado.
function normalizeLines(raw, opts) {
  const skipAvailability = !!(opts && opts.skipAvailability);
  if (!Array.isArray(raw) || raw.length === 0) return fail("El pedido está vacío");
  if (raw.length > MAX_LINES) return fail(`Máximo ${MAX_LINES} hamburguesas por pedido`);

  const lines = [];
  let total = 0;

  for (const r of raw) {
    const p = CATALOG.products[r && r.key];
    if (!p) return fail("Producto desconocido");
    if (!p.available && !skipAvailability) return fail(`${p.name} no está disponible`);

    const line = { key: r.key, bread: null, fries: null, sauce: null, extras: [], drink: null, note: "" };

    if (p.bread) {
      if (!MAPS.bread[r.bread]) return fail(`Falta elegir el pan de ${p.name}`);
      line.bread = r.bread;
    }
    if (p.fries) {
      if (!MAPS.fries[r.fries]) return fail(`Faltan elegir las papas de ${p.name}`);
      line.fries = r.fries;
    }
    if (!MAPS.sauce[r.sauce]) return fail(`Falta elegir la salsa de ${p.name}`);
    line.sauce = r.sauce;

    if (!MAPS.drinks[r.drink]) return fail(`Falta elegir la bebida de ${p.name}`);
    line.drink = r.drink;

    const extras = Array.isArray(r.extras) ? r.extras : [];
    for (const e of extras) {
      if (MAPS.extras[e] && line.extras.indexOf(e) === -1) line.extras.push(e);
    }
    line.note = cleanText(r.note, 120);

    lines.push(line);
    total += p.price;
  }

  return { ok: true, lines, total };
}

// Versión chiquita del pedido para guardarla en Mercado Pago (metadata)
// y recuperarla cuando el pago se aprueba.
function compactCart(lines) {
  return lines.map((l) => ({
    k: l.key,
    b: l.bread || "",
    f: l.fries || "",
    s: l.sauce || "",
    e: l.extras.join(","),
    d: l.drink || "",
    n: l.note || "",
  }));
}

function expandCart(cart) {
  if (!Array.isArray(cart)) return fail("Sin carrito");
  return normalizeLines(
    cart.map((c) => ({
      key: c.k,
      bread: c.b,
      fries: c.f,
      sauce: c.s,
      extras: String(c.e || "").split(",").filter(Boolean),
      drink: c.d,
      note: c.n,
    })),
    { skipAvailability: true }
  );
}

// Arma los ítems para Thinkion: cada hamburguesa es un ítem "padre" y sus
// opciones (pan, papas, salsa, aderezos, bebida) son ítems "hijos" (id_parent),
// a $0, así en el KDS salen agrupados debajo de la hamburguesa.
function buildThinkionItems(lines) {
  const items = [];
  let idItem = 0;
  let ordering = 0;

  for (const l of lines) {
    const p = CATALOG.products[l.key];
    const parentId = ++idItem;
    items.push({
      id_item: parentId,
      id_product: p.id,
      id_parent: 0,
      name: p.name,
      amount: 1,
      price: p.price,
      notes: l.note || "",
      ordering: ordering++,
    });

    const kids = [];
    if (l.bread) kids.push(MAPS.bread[l.bread]);
    if (l.fries) kids.push(MAPS.fries[l.fries]);
    if (l.sauce) kids.push(MAPS.sauce[l.sauce]);
    for (const e of l.extras) kids.push(MAPS.extras[e]);
    if (l.drink) kids.push(MAPS.drinks[l.drink]);

    for (const k of kids) {
      items.push({
        id_item: ++idItem,
        id_product: k.id,
        id_parent: parentId,
        name: k.name,
        amount: 1,
        price: 0,
        notes: "",
        ordering: ordering++,
      });
    }
  }
  return items;
}

// Endpoint público: la carta lo llama para conocer precios y opciones.
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Método no permitido" };
  }
  const products = {};
  for (const [key, p] of Object.entries(CATALOG.products)) {
    products[key] = { price: p.price, available: p.available, bread: p.bread, fries: p.fries };
  }
  const opt = (list) =>
    list.map((o) => ({ key: o.key, label: o.label, short: o.short, default: !!o.default }));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      ok: true,
      products,
      options: {
        bread: opt(CATALOG.bread),
        fries: opt(CATALOG.fries),
        sauce: opt(CATALOG.sauce),
        extras: opt(CATALOG.extras),
        drinks: opt(CATALOG.drinks),
      },
    }),
  };
};

// Para que las otras funciones usen el mismo catálogo.
exports.CATALOG = CATALOG;
exports.MAPS = MAPS;
exports.cleanText = cleanText;
exports.normalizeLines = normalizeLines;
exports.compactCart = compactCart;
exports.expandCart = expandCart;
exports.buildThinkionItems = buildThinkionItems;
