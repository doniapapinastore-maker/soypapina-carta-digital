// sw.js — Doña Papina
// Recibe la notificación de "pedido listo" aunque la carta esté cerrada o el celular bloqueado.
// El sonido de la notificación lo pone el teléfono; la vibración la elegimos acá (larga, para que se note).

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data && event.data.text() }; }
  // Le avisamos en el acto a las páginas de la carta que estén abiertas (así el cartel cambia junto con la notificación)
  var tell = self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    list.forEach(function (c) { c.postMessage({ type: 'pedido', code: d.code || '', status: d.status || 'ready' }); });
  }).catch(function () {});
  event.waitUntil(Promise.all([tell, self.registration.showNotification(d.title || 'Doña Papina', {
    body: d.body || '',
    tag: d.tag || 'pedido',
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: d.vibrate || [600, 200, 600, 200, 600, 200, 1200],
    data: { url: d.url || '/', code: d.code || '', name: d.name || '' }
  })]));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var url = data.url || '/';
  // Avisamos que el cliente ya vio el aviso (así no le llega el recordatorio)
  var ack = data.code ? fetch('/.netlify/functions/listos', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'ack', code: data.code, name: data.name })
  }).catch(function () {}) : Promise.resolve();
  event.waitUntil(Promise.all([ack, self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow(url);
  })]));
});
