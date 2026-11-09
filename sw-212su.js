/* 212.SU V12: network-only home navigation. No caches, no background sync, no push. */
'use strict';
const OFFLINE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>212.SU — нет подключения</title><style>body{margin:0;font:16px/1.6 system-ui,-apple-system,'Segoe UI',Arial,sans-serif;background:#f2f8ff;color:#143452;min-height:100vh;display:grid;place-items:center}main{margin:24px;max-width:440px;padding:30px;background:#fff;border:1px solid #dbe9f9;border-radius:20px}h1{font-size:26px;color:#0754a3;margin:0 0 8px}p{margin:0 0 20px}a{display:inline-block;background:#0774e8;color:white;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:650}small{display:block;margin-top:17px;color:#58728b}</style></head><body><main><h1>212.SU</h1><p>Нет подключения к интернету. Подключитесь к сети и откройте витрину снова.</p><a href="/">Повторить</a><small>Предложения и условия займов не сохраняются для просмотра без интернета.</small></main></body></html>`;
self.addEventListener('install',function () { self.skipWaiting(); });
self.addEventListener('activate',function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch',function (event) {
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || (url.pathname !== '/' && url.pathname !== '/index.html')) return;
  event.respondWith(fetch(event.request).catch(function () {
    return new Response(OFFLINE, {status:503, statusText:'Service Unavailable', headers:{
      'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'
    }});
  }));
});
