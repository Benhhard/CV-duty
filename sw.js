/* 心臟內科班表 — Service Worker
   ------------------------------------------------------------------
   離線策略
     · 班表資料 schedule.json → 網路優先，失敗才用快取
       （這樣排班者上傳新班表後，同仁一開就會拿到新的）
     · App 本身（HTML／圖示） → 快取優先，背景更新
   改版時把 VERSION 加一，舊快取會自動清掉。
   ------------------------------------------------------------------ */
const VERSION = 'v10';
const CACHE   = 'cv-duty-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 個別加入，任何一個檔案缺少都不會讓整個安裝失敗
    await Promise.all(SHELL.map(u =>
      c.add(new Request(u, { cache: 'reload' })).catch(() => null)
    ));
    self.skipWaiting();                    // 新版本立刻進入 waiting
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('cv-duty-') && k !== CACHE)
                          .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'VERSION')      e.source && e.source.postMessage({ version: VERSION });
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // 外部資源不攔截

  // 班表資料：網路優先
  if (url.pathname.endsWith('schedule.json')) {
    // App 會加上 ?t=時間戳 防瀏覽器快取，這裡一律正規化成同一個 key，
    // 否則離線時會因為時間戳不同而永遠查不到快取。
    const KEY = new URL('schedule.json', location.href).href;
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) (await caches.open(CACHE)).put(KEY, fresh.clone());
        return fresh;
      } catch (err) {
        const hit = await caches.match(KEY);
        if (hit) return hit;
        // 沒有任何快取時回 503，讓 App 明確知道要退回內建資料
        return new Response('offline', { status: 503 });
      }
    })());
    return;
  }

  // 其他：快取優先 + 背景更新
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    const net = fetch(req).then(async res => {
      if (res && res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    }).catch(() => null);

    if (hit) { e.waitUntil(net); return hit; }

    const res = await net;
    if (res) return res;
    // 導覽請求離線且無快取時，退回首頁
    if (req.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return new Response('離線中且沒有快取內容。', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  })());
});
