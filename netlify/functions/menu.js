// netlify/functions/menu.js
//
// FUENTE ÚNICA de productos, precios y opciones de la carta.
//
//  - Los PRECIOS se leen EN VIVO de Thinkion (API de reportes, reporte 132
//    "Productos: Precios base"). Cambiás el precio en Thinkion y la carta lo toma sola
//    (tarda como mucho 1 minuto).
//  - Si Thinkion no responde, se usan los últimos precios que se leyeron bien, y si
//    nunca se pudo leer, los precios de respaldo escritos acá abajo ("price").
//  - create-preference.js y mp-webhook.js usan este mismo catálogo para calcular
//    el total y armar el pedido, así que el celular del cliente NUNCA decide el precio.
//
// Variables en Netlify que usa este archivo:
//   THINKION_REPORT_TOKEN   token de la API de reportes (obligatoria para precios en vivo)
//   THINKION_REPORT_URL     opcional (por defecto https://papi.thinkerp.cc/online/reporting/public/)
//   THINKION_ESTABLISHMENT  opcional (por defecto 1)
//   THINKION_NODE, THINKION_CLIENT_CODE, THINKION_TOKEN   (API de ventas, como siempre)

const CATALOG = {
  // ─── Productos de la carta: combos y hamburguesas solas ──────────
  // id    = id_product en Thinkion (solo productos con Validación = 1)
  // price = precio de RESPALDO (el real viene de Thinkion)
  // bread / fries / sauce / drink / extras = qué opciones se eligen en ese producto
  // available = false para mostrarlo como "Agotada" y que no se pueda pedir
  products: {
    ldv: { id: 167, code: "LDV", name: "COMBO LDV La Doble Vida",      price: 18500, bread: true,  fries: true,  sauce: true,  drink: true,  extras: true, available: true },
    hdp: { id: 157, code: "HDP", name: "COMBO HDP Hambre de Papina",   price: 14000, bread: true,  fries: true,  sauce: true,  drink: true,  extras: true, available: true },
    tmb: { id: 158, code: "TMB", name: "COMBO TMB Tenes Mucho Bacon",  price: 15500, bread: true,  fries: true,  sauce: true,  drink: true,  extras: true, available: true },
    qlp: { id: 159, code: "QLP", name: "COMBO QLP Que Locura Papina",  price: 19900, bread: true,  fries: true,  sauce: true,  drink: true,  extras: true, available: true },
    lp:  { id: 160, code: "LP",  name: "COMBO LP LA PECADORA",         price: 16100, bread: true,  fries: true,  sauce: true,  drink: true,  extras: true, available: true },
    lt:  { id: 161, code: "LT",  name: "COMBO LT La Traicionera",      price: 20500, bread: true,  fries: true,  sauce: true,  drink: true,  extras: true, available: true },
    lc:  { id: 162, code: "LC",  name: "COMBO LC La Consentida",       price: 15000, bread: true,  fries: true,  sauce: true,  drink: true,  extras: true, available: true },
    lm:  { id: 163, code: "LM",  name: "COMBO LM La Malcriada",        price: 19000, bread: true,  fries: true,  sauce: true,  drink: true,  extras: true, available: true },
    lfs: { id: 164, code: "LFS", name: "COMBO LFS La Falsa Sana",      price: 14500, bread: true,  fries: true,  sauce: true,  drink: true,  extras: true, available: true },
    // Los chiquitos
    lpp: { id: 165, code: "LPP", name: "COMBO LPP La Pequeña Papina",  price: 13500, bread: true,  fries: true,  sauce: true,  drink: true,  extras: true, available: true },
    pn:  { id: 175, code: "PN",  name: "PAPINUGETTS",                  price: 10000, bread: false, fries: false, sauce: false, drink: false, extras: true, available: true },
    ltp: { id: 143, code: "LTP", name: "La Traviesa Papina",           price: 0,     bread: false, fries: false, sauce: false, drink: false, extras: false, available: false, noLive: true },

    // Hamburguesas SOLAS (sin papas ni bebida): pan, salsa y aderezos
    s_ldv: { id: 166, code: "LDV", name: "LDV La Doble Vida",      price: 13500, bread: true, fries: false, sauce: true, drink: false, extras: true, available: true },
    s_hdp: { id: 132, code: "HDP", name: "HDP Hambre de Papina",   price: 9000,  bread: true, fries: false, sauce: true, drink: false, extras: true, available: true },
    s_tmb: { id: 134, code: "TMB", name: "TMB Tenes Mucho Bacon",  price: 10500, bread: true, fries: false, sauce: true, drink: false, extras: true, available: true },
    s_qlp: { id: 135, code: "QLP", name: "QLP Que Locura Papina",  price: 14900, bread: true, fries: false, sauce: true, drink: false, extras: true, available: true },
    s_lp:  { id: 136, code: "LP",  name: "LP LA PECADORA",         price: 11500, bread: true, fries: false, sauce: true, drink: false, extras: true, available: true },
    s_lt:  { id: 137, code: "LT",  name: "LT La Traicionera",      price: 15500, bread: true, fries: false, sauce: true, drink: false, extras: true, available: true },
    s_lc:  { id: 138, code: "LC",  name: "LC La Consentida",       price: 9900,  bread: true, fries: false, sauce: true, drink: false, extras: true, available: true },
    s_lm:  { id: 139, code: "LM",  name: "LM La Malcriada",        price: 14000, bread: true, fries: false, sauce: true, drink: false, extras: true, available: true },
    s_lfs: { id: 140, code: "LFS", name: "LFS La Falsa Sana",      price: 9600,  bread: true, fries: false, sauce: true, drink: false, extras: true, available: true },
    s_lpp: { id: 142, code: "LPP", name: "LPP La Pequeña Papina",  price: 8500,  bread: true, fries: false, sauce: true, drink: false, extras: true, available: true },
  },

  // ─── Opciones (van a Thinkion como productos "hijos", a $0) ──────
  // label = texto completo (resumen y comprobante) · short = texto del botón
  // available = false → se ve en gris con "Sin stock" y no se puede elegir
  bread: [
    { key: "pan_papa",           id: 173, name: "PAN DE PAPA CLASICO",   label: "Pan de papa clásico",       short: "Pan de papa clásico", available: true },
    { key: "pan_papa_parmesano", id: 174, name: "PAN DE PAPA PARMESANO", label: "Pan de papa con parmesano", short: "Pan de papa con parmesano", available: true },
  ],
  fries: [
    { key: "sazonadas", id: 169, name: "PAPAS FRITAS SAZONADAS", label: "Papas sazonadas", short: "Sazonadas", default: true, available: true },
    { key: "clasicas",  id: 168, name: "PAPAS FRITAS CLASICAS",  label: "Papas clásicas",  short: "Clásicas", available: true },
  ],
  sauce: [
    { key: "tasty", id: 170, name: "SALSA TASTY",       label: "Salsa Tasty",       short: "Tasty", default: true, available: true },
    { key: "honey", id: 171, name: "SALSA SWEET HONEY", label: "Salsa Sweet Honey", short: "Sweet Honey", available: true },
  ],
  extras: [
    { key: "mayonesa", id: 176, name: "MAYONESA", label: "Mayonesa", short: "Mayonesa", available: true },
    { key: "mostaza",  id: 177, name: "MOSTAZA",  label: "Mostaza",  short: "Mostaza", available: true },
    { key: "ketchup",  id: 178, name: "KETCHUP",  label: "Ketchup",  short: "Ketchup", available: true },
  ],
  drinks: [
    { key: "sin_bebida",   id: null, name: "SIN BEBIDA",             label: "Sin bebida",                 short: "Sin bebida", available: true },
    { key: "coca_500",     id: 179, name: "COCA COLA 500ML",         label: "Coca-Cola 500",              short: "Coca-Cola 500", default: true, available: true },
    { key: "agua_sin_gas", id: 8,   name: "AGUA SIN GAS",            label: "Agua sin gas",               short: "Agua sin gas", available: false },
    { key: "agua_con_gas", id: 4,   name: "AGUA CON GAS",            label: "Agua con gas",               short: "Agua con gas", available: false },
    { key: "sab_manzana",  id: 5,   name: "AGUA SABORIZADA MANZANA", label: "Agua saborizada de manzana", short: "Saborizada manzana", available: false },
    { key: "sab_pomelo",   id: 7,   name: "AGUA SABORIZADA POMELO",  label: "Agua saborizada de pomelo",  short: "Saborizada pomelo", available: false },
    { key: "sevenup_500",  id: 116, name: "7 UP 500",                label: "7up 500",                    short: "7up 500", available: false },
  ],
};

// ─── Descuentos y códigos ─────────────────────────────────────────────────
// Descuentos: los mismos que existen en Thinkion (id = id_discount en Thinkion).
CATALOG.discounts = {
  d10:    { id: 1, name: "Descuento 10% off", percent: 10 },
  duenos: { id: 2, name: "Consumo dueños",    percent: 99 },
  casa:   { id: 3, name: "Invita la casa",    percent: 100 },
};

// Códigos que se le pueden dar a un cliente. Cada código apunta a un descuento.
//   expires (opcional): último día válido, formato "2026-12-31" (hora de Argentina).
// Para agregar un código: una línea nueva. Para anularlo: borrá la línea.
// IMPORTANTE: los códigos del 100% ("casa") hacen pedidos GRATIS.
CATALOG.coupons = {
  LACASAINVITA: { discount: "casa" },
};

const MAX_LINES = 20; // productos por pedido

const byKey = (list) => Object.fromEntries(list.map((o) => [o.key, o]));
const MAPS = {
  bread: byKey(CATALOG.bread),
  fries: byKey(CATALOG.fries),
  sauce: byKey(CATALOG.sauce),
  extras: byKey(CATALOG.extras),
  drinks: byKey(CATALOG.drinks),
};

// ─── Precios en vivo desde Thinkion (reporte 132) ─────────────────────────
const REPORT_ID = 132;
const PRICE_TTL_MS = 60 * 1000;       // precios leídos bien: se reusan 1 minuto
const PRICE_RETRY_MS = 20 * 1000;     // si falló: se reintenta a los 20 segundos
const REPORT_TIMEOUT_MS = 6000;
const MAX_PAGES = 20;

const priceState = {
  source: "respaldo",   // "thinkion" cuando se leyó bien al menos una vez
  updatedAt: null,      // fecha de la última lectura buena
  nextTry: 0,
  missing: [],          // ids de la carta que no vinieron en el reporte
  lastError: null,
  pending: null,
};

function todayAR() {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(new Date()); // AAAA-MM-DD
}

function parsePrice(v) {
  if (typeof v === "number") return v;
  let s = String(v == null ? "" : v).replace(/[^\d.,-]/g, "");
  if (!s) return NaN;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 14.000,00
  else s = s.replace(/,/g, "");                                        // 14,000.00 o 14000.00
  return parseFloat(s);
}

function pickKey(row, names) {
  const keys = Object.keys(row);
  for (const n of names) {
    const k = keys.find((x) => x.trim().toLowerCase() === n);
    if (k) return k;
  }
  return null;
}

// Convierte una fila del reporte en { id, price } (o null si no se entiende).
function readRow(row) {
  if (Array.isArray(row)) {
    if (row.length < 2) return null;
    return { id: Number(row[0]), price: parsePrice(row[row.length - 1]) };
  }
  if (!row || typeof row !== "object") return null;
  const kId = pickKey(row, ["id", "id_product", "id producto", "id_producto"]);
  const kPrice = pickKey(row, ["precio", "price", "precio base", "precio_base"]);
  if (!kId || !kPrice) return null;
  return { id: Number(row[kId]), price: parsePrice(row[kPrice]) };
}

async function fetchReportPage(url, token, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Server-Token": token },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok || !json || json.data === undefined) {
      throw new Error(`reporte ${REPORT_ID}: http ${resp.status} ${json && json.message ? json.message : ""}`.trim());
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function loadLivePrices() {
  const token = process.env.THINKION_REPORT_TOKEN;
  if (!token) throw new Error("Falta la variable THINKION_REPORT_TOKEN en Netlify");
  const url = process.env.THINKION_REPORT_URL || "https://papi.thinkerp.cc/online/reporting/public/";
  const est = Number(process.env.THINKION_ESTABLISHMENT || 1);
  const day = todayAR();

  const found = {};
  let page = "";
  for (let n = 0; n < MAX_PAGES; n++) {
    const body = { id_report: REPORT_ID, date_init: day, date_end: day, establishments: [est] };
    if (page) body.page = page;
    const json = await fetchReportPage(url, token, body);
    const rows = Array.isArray(json.data) ? json.data : [json.data];
    for (const r of rows) {
      const x = readRow(r);
      if (!x || !Number.isFinite(x.id) || !Number.isFinite(x.price)) continue;
      if (found[x.id] === undefined) found[x.id] = x.price;
    }
    if (!json.page || json.page === page) break;
    page = json.page;
  }
  if (!Object.keys(found).length) throw new Error(`reporte ${REPORT_ID}: vino vacío o con columnas desconocidas`);
  return found;
}

// Actualiza los precios del catálogo con los de Thinkion. Nunca tira error:
// si falla, deja los últimos precios buenos (o los de respaldo).
async function refreshPrices(force) {
  const now = Date.now();
  if (!force && now < priceState.nextTry) return priceState;
  if (priceState.pending) return priceState.pending;

  priceState.pending = (async () => {
    try {
      const live = await loadLivePrices();
      const missing = [];
      for (const p of Object.values(CATALOG.products)) {
        if (p.noLive) continue;
        const v = live[p.id];
        if (Number.isFinite(v) && v > 0) p.price = Math.round(v);
        else missing.push(p.id);
      }
      priceState.source = "thinkion";
      priceState.updatedAt = new Date().toISOString();
      priceState.missing = missing;
      priceState.lastError = null;
      priceState.nextTry = Date.now() + PRICE_TTL_MS;
      if (missing.length) console.warn("Precios: estos ids no vinieron en el reporte 132 (uso respaldo):", missing.join(", "));
    } catch (err) {
      priceState.lastError = String((err && err.message) || err);
      priceState.nextTry = Date.now() + PRICE_RETRY_MS;
      console.error("Precios: no se pudieron leer de Thinkion, sigo con los últimos conocidos:", priceState.lastError);
    } finally {
      priceState.pending = null;
    }
    return priceState;
  })();
  return priceState.pending;
}

// ─── Validación del pedido ─────────────────────────────────────────────────
const fail = (error) => ({ ok: false, error });

function cleanText(v, max) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
}

const wants = (p, what) => p[what] !== false;

// Valida lo que mandó el celular y lo deja en forma "limpia".
// Devuelve { ok:true, lines, total } o { ok:false, error }.
// opts.skipAvailability: lo usa el webhook (un pedido YA PAGADO se carga igual).
// opts.prices: precios ya cobrados (los usa el webhook), uno por línea.
function normalizeLines(raw, opts) {
  const skipAvailability = !!(opts && opts.skipAvailability);
  const fixedPrices = opts && Array.isArray(opts.prices) ? opts.prices : null;
  if (!Array.isArray(raw) || raw.length === 0) return fail("El pedido está vacío");
  if (raw.length > MAX_LINES) return fail(`Máximo ${MAX_LINES} productos por pedido`);

  const lines = [];
  let total = 0;

  const pickOne = (map, key, p, errMsg) => {
    const o = map[key];
    if (!o) return { error: errMsg };
    if (o.available === false && !skipAvailability) return { error: `${o.label} no tiene stock` };
    return { key };
  };

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const p = CATALOG.products[r && r.key];
    if (!p) return fail("Producto desconocido");
    if (!p.available && !skipAvailability) return fail(`${p.name} no está disponible`);

    const line = { key: r.key, bread: null, fries: null, sauce: null, extras: [], drink: null, note: "", price: p.price };

    if (p.bread) {
      const x = pickOne(MAPS.bread, r.bread, p, `Falta elegir el pan de ${p.name}`);
      if (x.error) return fail(x.error);
      line.bread = x.key;
    }
    if (p.fries) {
      const x = pickOne(MAPS.fries, r.fries, p, `Faltan elegir las papas de ${p.name}`);
      if (x.error) return fail(x.error);
      line.fries = x.key;
    }
    if (wants(p, "sauce")) {
      const x = pickOne(MAPS.sauce, r.sauce, p, `Falta elegir la salsa de ${p.name}`);
      if (x.error) return fail(x.error);
      line.sauce = x.key;
    }
    if (wants(p, "drink")) {
      const x = pickOne(MAPS.drinks, r.drink, p, `Falta elegir la bebida de ${p.name}`);
      if (x.error) return fail(x.error);
      line.drink = x.key;
    }
    if (wants(p, "extras")) {
      const extras = Array.isArray(r.extras) ? r.extras : [];
      for (const e of extras) {
        const o = MAPS.extras[e];
        if (!o || line.extras.indexOf(e) !== -1) continue;
        if (o.available === false && !skipAvailability) return fail(`${o.label} no tiene stock`);
        line.extras.push(e);
      }
    }
    line.note = cleanText(r.note, 120);

    if (fixedPrices && Number.isFinite(Number(fixedPrices[i])) && Number(fixedPrices[i]) > 0) {
      line.price = Math.round(Number(fixedPrices[i]));
    }

    lines.push(line);
    total += line.price;
  }

  return { ok: true, lines, total };
}

// Versión chiquita del pedido para guardarla en Mercado Pago (metadata)
// y recuperarla cuando el pago se aprueba. Incluye el precio cobrado.
function compactCart(lines) {
  return lines.map((l) => ({
    k: l.key,
    b: l.bread || "",
    f: l.fries || "",
    s: l.sauce || "",
    e: l.extras.join(","),
    d: l.drink || "",
    n: l.note || "",
    p: l.price,
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
    { skipAvailability: true, prices: cart.map((c) => c.p) }
  );
}

// Arma los ítems para Thinkion: cada producto es un ítem "padre" y sus
// opciones (pan, papas, salsa, aderezos, bebida) son ítems "hijos" (id_parent),
// a $0, así en el KDS salen agrupados debajo del producto.
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
      price: Number.isFinite(l.price) ? l.price : p.price,
      notes: [l.drink === "sin_bebida" ? "SIN BEBIDA" : "", l.note || ""].filter(Boolean).join(" - "),
      ordering: ordering++,
    });

    const kids = [];
    if (l.bread) kids.push(MAPS.bread[l.bread]);
    if (l.fries) kids.push(MAPS.fries[l.fries]);
    if (l.sauce) kids.push(MAPS.sauce[l.sauce]);
    for (const e of l.extras) kids.push(MAPS.extras[e]);
    if (l.drink) kids.push(MAPS.drinks[l.drink]);

    for (const k of kids) {
      if (!k || !k.id) continue; // "Sin bebida" no se manda como producto
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

// ─── Códigos de descuento ──────────────────────────────────────────────────
function resolveCoupon(raw, opts) {
  const skipExpiry = !!(opts && opts.skipExpiry);
  const code = String(raw == null ? "" : raw).toUpperCase().replace(/\s+/g, "");
  const def = code && Object.prototype.hasOwnProperty.call(CATALOG.coupons, code) ? CATALOG.coupons[code] : null;
  const generic = "Ese código no es válido o ya venció.";
  if (!def) return fail(generic);
  if (def.expires && !skipExpiry) {
    const end = new Date(def.expires + "T23:59:59-03:00");
    if (isNaN(end.getTime()) || Date.now() > end.getTime()) return fail(generic);
  }
  const d = CATALOG.discounts[def.discount];
  if (!d) return fail(generic);
  return { ok: true, code, key: def.discount, id: d.id, name: d.name, percent: d.percent };
}

// Descuento en pesos enteros. La carta usa exactamente la misma cuenta.
function applyDiscount(subtotal, percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const discount = Math.round((subtotal * p) / 100);
  return { subtotal, discount, pay: subtotal - discount };
}

// ─── Thinkion (ventas) ─────────────────────────────────────────────────────
const THINKION_TIMEOUT_MS = 8000;

function thinkionUrl() {
  return `https://s${process.env.THINKION_NODE}.${process.env.THINKION_CLIENT_CODE}.thinkerp.cc/order/set/`;
}

function buildThinkionOrder(o) {
  const disc = o.discount && o.discount.amount > 0 ? o.discount : null;
  // El nombre va primero en las notas para que se vea en el KDS (el de Thinkion y el propio)
  const notes = [`CLIENTE: ${cleanText(o.name || "Cliente", 60).toUpperCase()}`, "RETIRA EN EL LOCAL"];
  if (disc) notes.push(`CODIGO ${disc.code}`);
  const general = cleanText(o.generalNotes, 300);
  if (general) notes.push(general);
  return {
    details: {
      id_order: o.orderId,
      sale_channel: "digital",
      notes: cleanText(notes.join(" - "), 500),
      total: { debt: o.debt, discount: disc ? disc.amount : 0 },
    },
    customer: {
      id_customer: 1,
      name: o.name || "Cliente",
      surname: "",
      email: o.email || "sin-email@soypapina.com",
      tel: null,
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
    items: buildThinkionItems(o.lines),
    discounts: disc ? [{ id_discount: disc.id, name: disc.name, total: disc.amount }] : [],
    payments: o.payment ? [o.payment] : [],
  };
}

async function sendToThinkion(order) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), THINKION_TIMEOUT_MS);
  try {
    const resp = await fetch(thinkionUrl(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Server-Token": process.env.THINKION_TOKEN,
      },
      body: JSON.stringify([order]),
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await resp.json();
    } catch (e) {
      data = null;
    }
    const d = data || {};
    const confirmed =
      resp.ok &&
      d.result === true &&
      Array.isArray(d.confirm) &&
      d.confirm.map(Number).indexOf(Number(order.details.id_order)) !== -1;
    return { confirmed, httpOk: resp.ok, status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function freeOrderId() {
  return Number("99" + String(Date.now()).slice(-10));
}

// Endpoint público: la carta lo llama para conocer precios y opciones.
// Para revisar de dónde salen los precios, abrí /.netlify/functions/menu y mirá "fuente".
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Método no permitido" };
  }
  await refreshPrices();

  const products = {};
  for (const [key, p] of Object.entries(CATALOG.products)) {
    products[key] = {
      price: p.price,
      available: p.available,
      bread: p.bread,
      fries: p.fries,
      sauce: wants(p, "sauce"),
      drink: wants(p, "drink"),
      extras: wants(p, "extras"),
    };
  }
  const opt = (list) =>
    list.map((o) => ({ key: o.key, label: o.label, short: o.short, default: !!o.default, available: o.available !== false }));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      ok: true,
      fuente: priceState.source,
      actualizado: priceState.updatedAt,
      sin_precio_en_thinkion: priceState.missing,
      error_precios: priceState.lastError,
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
exports.resolveCoupon = resolveCoupon;
exports.applyDiscount = applyDiscount;
exports.buildThinkionOrder = buildThinkionOrder;
exports.sendToThinkion = sendToThinkion;
exports.freeOrderId = freeOrderId;
exports.refreshPrices = refreshPrices;
