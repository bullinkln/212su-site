/* 212.SU V12 FINAL — direct PWA install flow + Yandex Metrika funnel.
   SEO, LeadCore, app identity, service worker and icons are unchanged.
   This release performs ONE global reset of all earlier local PWA preferences by moving to schema v4.
   After the first V12 visit, normal 24h suppression and installed-state memory work again.
   No push permission, forced navigation, APK downloads or automatic pinning. */
(function () {
  'use strict';
  if (window.top !== window.self) return;
  const byId = id => document.getElementById(id);
  const banner = byId('pwa-install-banner');
  const primary = byId('pwa-banner-install');
  const manual = byId('pwa-manual-install');
  const help = byId('pwa-help-dialog');
  if (!banner || !primary || !manual || !help) return;

  const DAY = 24 * 60 * 60 * 1000;
  const MIN_VISIT_MS = 7000;
  const SCROLL_PERCENT = 20;
  // Keep this key stable in future cosmetic releases. Do not reset at every refresh.
  const PREF_KEY = '212su.install.preference.v4';
  const LEGACY_KEYS = ['212su.install.preference.v3','212su.install.preference.v2'];
  const LOCK_KEY = '212su.install.promo';
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const win = /Windows NT/i.test(ua);
  const mac = !ios && /Macintosh|Mac OS X/i.test(ua);
  const cros = /CrOS/i.test(ua);
  const ya = /YaBrowser/i.test(ua);
  const edge = /Edg(?:e|A|iOS)?\//i.test(ua);
  const firefox = /Firefox\/|FxiOS\//i.test(ua);
  const samsung = /SamsungBrowser/i.test(ua);
  const opera = /OPR\/|OPiOS\//i.test(ua);
  const chrome = /Chrome\/|Chromium\/|CriOS\//i.test(ua) && !edge && !ya && !samsung && !opera;
  const safari = /Safari\//i.test(ua) && !chrome && !edge && !ya && !firefox && !samsung && !opera;
  const inApp = /FBAN|FBAV|Instagram|MicroMessenger|\bwv\b|VKAndroidApp|VKClient|Telegram/i.test(ua);
  const display = window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)');
  const mobile = ios || android;
  const platform = ios ? 'ios' : android ? 'android' : win ? 'windows' : mac ? 'macos' : cros ? 'chromeos' : 'desktop';
  const browser = ya ? 'yandex' : edge ? 'edge' : samsung ? 'samsung' : firefox ? 'firefox' : chrome ? 'chrome' : safari ? 'safari' : opera ? 'opera' : 'other';
  let deferredPrompt = null;
  let ready = false;
  let hasScrolled = false;
  let closedThisPage = false;
  let shownThisPage = false;
  let installing = false;
  let claiming = false;
  let returnFocus = null;
  let raf = 0;
  let layoutTimer = 0;
  let appOpenTracked = false;
  const memory = {};

  // Owner/test-only reset. This does NOT affect other visitors.
  // Open https://212.su/?pwa_reset=1 once after uninstalling the PWA.
  // The parameter is immediately removed from the visible URL.
  function applyTestReset() {
    let params;
    try { params = new URLSearchParams(window.location.search); } catch (_) { return; }
    if (params.get('pwa_reset') !== '1') return;
    for (const type of ['localStorage', 'sessionStorage']) {
      try {
        window[type].removeItem(PREF_KEY);
        LEGACY_KEYS.forEach(key => window[type].removeItem(key));
        window[type].removeItem(LOCK_KEY);
      } catch (_) { /* storage may be restricted */ }
    }
    delete memory[PREF_KEY];
    LEGACY_KEYS.forEach(key => { delete memory[key]; });
    delete memory[LOCK_KEY];
    try {
      params.delete('pwa_reset');
      const qs = params.toString();
      const clean = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
      history.replaceState(history.state, '', clean);
    } catch (_) { /* cosmetic only */ }
  }

  // Storage can be restricted. Local is preferred; session is a best-effort fallback.
  function read(key) {
    for (const type of ['localStorage', 'sessionStorage']) {
      try {
        const raw = window[type].getItem(key);
        if (raw) { const value = JSON.parse(raw); if (value && typeof value === 'object') return value; }
      } catch (_) { /* try the next storage tier */ }
    }
    return memory[key] || null;
  }
  function write(key, value) {
    memory[key] = value;
    for (const type of ['localStorage', 'sessionStorage']) {
      try { window[type].setItem(key, JSON.stringify(value)); return; } catch (_) { /* try fallback */ }
    }
  }
  function validUntil(pref) { return Boolean(pref && Number.isFinite(pref.until) && pref.until > Date.now()); }
  function standalone() { return Boolean(display.matches || navigator.standalone === true); }
  function installedKnown() { const p=read(PREF_KEY); return standalone() || Boolean(validUntil(p) && p.reason === 'installed'); }
  function suppressed() { return validUntil(read(PREF_KEY)); }
  function track(action, method) {
    const detail={action:action,platform:platform,browser:browser,method:method || ''};
    window.dispatchEvent(new CustomEvent('212su:pwa', {detail:detail}));

    // Send only anonymous interaction metadata to the site's Yandex Metrika counter.
    // Goal identifiers are intentionally stable so reports survive cosmetic releases.
    const goals={
      promo_shown:'pwa_banner_show',
      promo_later:'pwa_banner_later',
      promo_close:'pwa_banner_close',
      install_requested:'pwa_install_click',
      install_accepted:'pwa_prompt_accept',
      install_declined:'pwa_prompt_dismiss',
      install_confirmed:'pwa_installed',
      app_open:'pwa_app_open'
    };
    const goal=goals[action];
    if(goal && typeof window.ym==='function') {
      try { window.ym(114134642,'reachGoal',goal,{pwa_platform:platform,pwa_browser:browser,pwa_method:method || ''}); }
      catch (_) { /* Analytics must never block installation. */ }
    }
  }
  function trackAppOpen() {
    if(appOpenTracked || !standalone()) return;
    appOpenTracked=true;
    track('app_open','standalone');
  }
  function migrateOnce() {
    if (read(PREF_KEY)) return;
    const now=Date.now();
    // V12 launch reset: ignore and clear ALL earlier PWA preferences once for every browser.
    // This is intentional because the site has not launched to real users yet.
    for (const type of ['localStorage','sessionStorage']) {
      try { LEGACY_KEYS.forEach(key => window[type].removeItem(key)); } catch (_) { /* storage may be restricted */ }
    }
    LEGACY_KEYS.forEach(key => { delete memory[key]; });
    write(PREF_KEY,{schema:4,reason:'ready',until:0,resetAt:now});
  }
  function remember(reason) {
    const old=read(PREF_KEY) || {};
    // A resolved/rejected promise after appinstalled must never overwrite success.
    if (installedKnown()) return;
    write(PREF_KEY,{schema:4,reason:reason,shownAt:old.shownAt || null,decidedAt:Date.now(),until:Date.now()+DAY,migratedAt:old.migratedAt || null});
  }
  function nativeReady() { return Boolean(deferredPrompt && !standalone()); }
  function setText(id,value) { const el=byId(id); if(el) el.textContent=value; }
  function refreshCopy() {
    // Capability detection wins over user-agent hints. No mandatory pin instructions.
    primary.textContent = nativeReady() ? 'Установить' : inApp ? 'Как добавить' : mac && safari ? 'Добавить в Dock' : 'Добавить';
    manual.hidden = standalone() || (mobile && !nativeReady());
    manual.textContent = installedKnown() ? 'Найти значок 212.SU' : 'Добавить ярлык 212.SU';
    byId('pwa-help-native').hidden = help.dataset.mode==='installed' || !nativeReady();
  }
  function hideBanner() { banner.hidden=true; banner.classList.remove('pwa-attention'); }
  function focusSafely(target) {
    if (!target || !target.isConnected || target.hidden) return;
    try { target.focus({preventScroll:true}); } catch (_) { target.focus(); }
  }
  function viewportOK() {
    const vv=window.visualViewport;
    const h=vv ? vv.height : window.innerHeight;
    const active=document.activeElement;
    const editing=active && (/INPUT|TEXTAREA|SELECT/.test(active.tagName) || active.isContentEditable);
    return h>=430 && !(editing && vv && vv.height<window.innerHeight*.78);
  }
  function updatePosition() {
    // Leave the financial risk warning readable. Also works with inaccessible iframe notices.
    let space=76;
    const vh=window.innerHeight,vw=window.innerWidth;
    const nodes=document.querySelectorAll('body > *, #leadcore *');
    for (let i=0;i<Math.min(nodes.length,1800);i++) {
      const el=nodes[i];
      if (el===banner || el===help || banner.contains(el) || help.contains(el) || el.tagName==='SCRIPT' || el.tagName==='STYLE') continue;
      const style=getComputedStyle(el);
      if (style.position!=='fixed' || style.display==='none' || style.visibility==='hidden') continue;
      const r=el.getBoundingClientRect();
      if(r.width>vw*.45 && r.height>10 && r.height<180 && r.bottom>=vh-4 && r.top>vh*.55) space=Math.max(space,vh-r.top+10);
    }
    banner.style.setProperty('--pwa-bottom',Math.ceil(space)+'px');
    help.style.setProperty('--pwa-bottom',Math.ceil(space)+'px');
  }
  function scrollThreshold() {
    const offers=byId('offers');
    const root=document.scrollingElement || document.documentElement;
    const maxScroll=Math.max(0,root.scrollHeight-window.innerHeight);
    if(!offers) return Math.max(120,maxScroll*SCROLL_PERCENT/100);
    const rect=offers.getBoundingClientRect();
    const top=rect.top+window.scrollY;
    const travel=Math.max(0,rect.height-window.innerHeight*.55);
    return Math.min(Math.max(120,top+travel*SCROLL_PERCENT/100),Math.max(120,maxScroll));
  }
  function eligible() {
    if(!ready || closedThisPage || shownThisPage || installing || !help.hidden || installedKnown() || suppressed()) return false;
    // On phones the banner is shown only when a real browser-native install prompt is ready.
    // No intermediate instructions or fake install flow on mobile.
    if(mobile && !nativeReady()) return false;
    if(document.visibilityState!=='visible' || !viewportOK() || !hasScrolled || window.scrollY<scrollThreshold()) return false;
    const loader=byId('rating-loader');
    return !loader || loader.hidden;
  }
  function claimAndShow() {
    if(!eligible()) return;
    updatePosition();
    refreshCopy();
    // Reserve the 24h window on DISPLAY, not just on dismissal, so reloads don't nag.
    const old=read(PREF_KEY) || {};
    const now=Date.now();
    write(PREF_KEY,{schema:4,reason:'shown',shownAt:now,until:now+DAY,migratedAt:old.migratedAt || null});
    shownThisPage=true;
    banner.hidden=false;
    banner.classList.add('pwa-attention');
    track('promo_shown',nativeReady() ? 'native' : 'manual');
  }
  function maybeShow() {
    if(claiming || !eligible()) return;
    // Serialise automatic exposure across same-origin tabs where Web Locks is supported.
    if(navigator.locks && typeof navigator.locks.request==='function') {
      claiming=true;
      navigator.locks.request(LOCK_KEY,{ifAvailable:true},lock => {if(lock) claimAndShow();})
        .catch(() => {claimAndShow();}).finally(() => {claiming=false;});
    } else claimAndShow();
  }
  function dismiss(kind) {
    const action = kind === 'later' ? 'promo_later' : 'promo_close';
    remember(kind === 'later' ? 'later' : 'closed');
    closedThisPage=true; hideBanner();
    track(action, 'banner');
    focusSafely(byId('offers'));
  }

  function installedGuide() {
    if(ios || android) return {title:'Открывайте 212.SU по значку',subtitle:'Повторная установка обычно не нужна.',
      steps:['Найдите эмблему 212.SU на главном экране или в списке приложений.','Нажмите значок — откроется витрина.'],
      extra:'На Android найдите 212.SU в списке приложений и удерживайте значок, чтобы перенести его на главный экран. На iPhone используйте поиск по названию. Если вы удалили ярлык, добавьте его снова через меню браузера.'};
    if(mac) return {title:'Откройте 212.SU',subtitle:'Значок уже может находиться в Dock.',
      steps:['Нажмите значок 212.SU в Dock.','Если его нет, найдите 212.SU через Spotlight или папку «Приложения».'],
      extra:'Только если значок исчезает после закрытия: меню значка в Dock → «Параметры» → «Оставить в Dock».'};
    if(win) return {title:'Откройте 212.SU',subtitle:'Значок уже может находиться на панели задач.',
      steps:['Нажмите эмблему 212.SU на панели задач.','Если её нет, откройте «Пуск» и найдите 212.SU.'],
      extra:'Только если значок не остался на панели: откройте приложение → правой кнопкой по его значку → «Закрепить на панели задач».'};
    return {title:'Откройте 212.SU',subtitle:'Найдите приложение по знакомой эмблеме.',steps:['В списке приложений найдите 212.SU.','Нажмите значок, чтобы открыть витрину.'],extra:'Закрепление значка выполняется из его контекстного меню; название команды зависит от системы.'};
  }
  function installGuide() {
    if(inApp) return {title:'Добавить значок 212.SU',subtitle:'Встроенное окно может не поддерживать установку.',
      steps:['В меню этого окна выберите «Открыть в браузере».',ios ? 'Нажмите «Поделиться» → «На экран Домой» → «Добавить».' : 'В меню браузера выберите установку приложения или добавление на главный экран.'],
      note:'Если открыть браузер не получается, скопируйте адрес ниже.',copy:true};
    if(ios && ya) return {title:'212.SU на экране «Домой»',subtitle:'Останется значок с подписью 212.SU.',
      steps:['Откройте меню в Умной строке → «Добавить ярлык на телефон».','Выберите «Добавить на экран „Домой“» → «Добавить».'],
      extra:'Ярлык может открывать сайт во вкладке Яндекс Браузера. Если нужного пункта нет, используйте Safari: «Поделиться» → «На экран Домой».',copy:true};
    if(ios) return {title:'212.SU на экране «Домой»',subtitle:'Без App Store: сохраните сайт как приложение.',
      steps:[chrome ? 'Справа от адреса нажмите «Поделиться».' : 'Нажмите «Поделиться». В некоторых версиях сначала откройте меню страницы.',
        'Выберите «На экран Домой».','Оставьте название 212.SU и нажмите «Добавить». Если есть «Открывать как веб-приложение», включите его.'],
      extra:'Если «На экран Домой» нет в списке, откройте «Редактировать действия». Если браузер не поддерживает добавление, откройте адрес в Safari.',copy:!chrome && !safari};
    if(android && ya) return {title:'212.SU на главном экране',subtitle:'Знакомая эмблема рядом с приложениями.',
      steps:['Откройте меню Яндекс Браузера → «Добавить ярлык на рабочий стол».','Нажмите «Добавить». Если телефон запросит размещение, подтвердите его.'],
      extra:'Ярлык открывает витрину в Яндекс Браузере. Перенести значок на удобный экран можно долгим нажатием.'};
    if(android && samsung) return {title:'Добавить 212.SU на Samsung',subtitle:'Используйте Samsung Internet.',
      steps:['Нажмите значок установки в адресной строке. Или откройте меню → добавление на главный экран.','Подтвердите установку 212.SU.'],
      extra:'Значок может сначала появиться в списке приложений. Удерживайте его и выберите добавление на главный экран.'};
    if(android && firefox) return {title:'212.SU на главном экране',subtitle:'Добавление через Firefox.',
      steps:['Откройте меню Firefox → «Установить». Если есть только «Добавить на домашний экран», выберите его.','Подтвердите добавление.'],
      extra:'Название команды зависит от версии Firefox и телефона. После добавления ищите значок 212.SU.'};
    if(android) return {title:'212.SU на главном экране',subtitle:'Сохраните быстрый доступ к витрине.',
      steps:['Откройте меню ⋮ → «Установить и создать ярлык» → «Установить». В других версиях: «Добавить на главный экран» → «Установить».','Подтвердите установку. Если предложен только ярлык, выберите «Создать ярлык» или «Добавить».'],
      extra:'Если значок появился только в списке приложений, удерживайте его и перенесите на главный экран. Названия пунктов зависят от версии браузера.'};
    if(mac && safari) return {title:'212.SU в Dock',subtitle:'Safari сохранит сайт как отдельное приложение.',
      steps:['В верхнем меню Safari выберите «Файл» → «Добавить в Dock».','Оставьте название 212.SU и нажмите «Добавить».'],
      extra:'Нужна macOS Sonoma 14 или новее. В более старой системе можно использовать установку в Chrome или Edge.'};
    if(win && firefox) return {title:'Добавить 212.SU',subtitle:'Firefox умеет сохранять сайты как приложения.',
      steps:['Нажмите значок веб-приложения справа в адресной строке.','Если Windows предложит оставить значок на панели задач, подтвердите. Если запроса нет — дополнительных действий не нужно.'],
      extra:'Функция есть в Firefox для Windows 143+; для версии из Microsoft Store — 150+. Если значка установки нет, обновите браузер.'};
    if(firefox && !win) return {title:'Добавить 212.SU',subtitle:'Firefox на этой системе может не поддерживать установку.',
      steps:[mac ? 'Откройте этот адрес в Safari.' : 'Откройте этот адрес в Chrome или Edge.',mac ? '«Файл» → «Добавить в Dock» → «Добавить».' : 'Нажмите значок установки в адресной строке и подтвердите.'],
      note:'Браузер по умолчанию менять не нужно.',copy:true};
    if(win && ya) return {title:'Добавить 212.SU',subtitle:'Установка через Яндекс Браузер.',
      steps:['В Умной строке откройте меню сайта → «Установить как приложение».','Выберите открытие в отдельном окне и подтвердите добавление.'],
      extra:'Только если значок не закрепился: правой кнопкой по 212.SU в боковой панели → «Закрепить на панели задач Windows». Если уже закреплён, ничего делать не нужно.'};
    if(edge) return {title:'Добавить 212.SU',subtitle:'Установка через Microsoft Edge.',
      steps:['Нажмите значок установки в адресной строке. Или откройте ⋯ → «Дополнительные инструменты» → «Приложения» → «Установить этот сайт как приложение».','Подтвердите установку 212.SU.'],
      extra:win ? 'Если Edge предложит закрепление, выберите панель задач. Если значок уже появился и остаётся, ничего делать не нужно. Запасной путь: edge://apps → «Сведения» → «Закрепить на панели задач».' : mac ? 'Если значок исчезает из Dock после закрытия: меню значка → «Параметры» → «Оставить в Dock».' : 'Закрепление на панели или в избранном доступно в меню значка приложения.'};
    if(chrome || cros || ya || opera) return {title:'Добавить 212.SU',subtitle:'Сохраните витрину как отдельное приложение.',
      steps:['Нажмите значок установки в адресной строке. В Chrome также: ⋮ → «Трансляция, сохранение и отправка» → «Установить страницу как приложение».','Подтвердите установку 212.SU.'],
      extra:win ? 'Если значок уже остался на панели задач — всё готово. Иначе: правой кнопкой по значку открытого приложения → «Закрепить на панели задач».' : mac ? 'Если значок не остался в Dock: меню значка → «Параметры» → «Оставить в Dock».' : cros ? 'Для закрепления: меню значка 212.SU в списке приложений → «Закрепить на панели».' : 'Закрепление значка в избранном или на панели выполняется в меню приложения.'};
    return {title:'Добавить значок 212.SU',subtitle:'Способ зависит от вашего браузера.',
      steps:['В меню браузера найдите установку сайта как приложения или добавление ярлыка.','Оставьте название 212.SU и подтвердите.'],
      note:'Если такого пункта нет, используйте Chrome, Edge либо Safari на iPhone и Mac.',copy:true};
  }
  function openHelp(trigger,installed) {
    returnFocus=trigger || document.activeElement;
    const data=installed ? installedGuide() : installGuide();
    help.dataset.mode=installed ? 'installed' : 'install';
    hideBanner(); closedThisPage=true;
    if(!installed) remember('guide');
    setText('pwa-help-title',data.title);
    setText('pwa-help-subtitle',data.subtitle);
    const list=byId('pwa-help-steps');list.replaceChildren();
    data.steps.forEach(step => {const li=document.createElement('li');li.textContent=step;list.appendChild(li);});
    setText('pwa-help-note',data.note || '');byId('pwa-help-note').hidden=!data.note;
    const extra=byId('pwa-help-extra');extra.hidden=!data.extra;extra.open=false;
    setText('pwa-help-extra-text',data.extra || '');
    byId('pwa-help-address').hidden=!data.copy;
    byId('pwa-help-native').hidden=installed || !nativeReady();
    updatePosition();help.hidden=false;
    focusSafely(byId('pwa-help-close'));
    track(installed ? 'find_icon_open' : 'install_guide_open','manual');
  }
  function closeHelp() {
    help.hidden=true;
    if(help.dataset.mode!=='installed') remember('guide_closed');
    const target=returnFocus && returnFocus.isConnected && !banner.contains(returnFocus) ? returnFocus : byId('offers');
    focusSafely(target);
  }
  function recordInstalled(method) {
    deferredPrompt=null;
    const now=Date.now();
    const old=read(PREF_KEY) || {};
    write(PREF_KEY,{schema:4,reason:'installed',installedAt:now,until:now+365*DAY,migratedAt:old.migratedAt || null});
    closedThisPage=true;help.hidden=true;hideBanner();refreshCopy();
    track('install_confirmed',method || 'appinstalled');
    // No automatic "pin your app" upsell or confirmation panel after success.
  }
  async function requestInstall(trigger) {
    if(installing) return;
    if(installedKnown()) { if(!mobile) openHelp(trigger,true); return; }
    if(!nativeReady()) {
      // Mobile: never open our own instructions. Direct browser prompt or nothing.
      if(mobile) { remember('native_unavailable'); hideBanner(); track('install_unavailable','native'); return; }
      openHelp(trigger,false);return;
    }
    const event=deferredPrompt;
    deferredPrompt=null;installing=true;closedThisPage=true;
    primary.disabled=true;byId('pwa-help-native').disabled=true;
    remember('requested');hideBanner();help.hidden=true;
    try {
      // Native prompt must be called directly in the user gesture, before awaiting anything.
      const promptPromise=event.prompt();
      track('install_requested','native');
      // Modern implementations return userChoice here; older ones expose it on the event.
      const prompted=await promptPromise;
      const result=(prompted && prompted.outcome) ? prompted : await event.userChoice;
      if(result && result.outcome==='accepted') {
        remember('accepted');track('install_accepted','native');
      } else if(!installedKnown()) {
        remember('dismissed');track('install_declined','native');
      }
    } catch (_) {
      if(!installedKnown()) {
        if(mobile) { remember('native_error'); hideBanner(); track('install_error','native'); }
        else openHelp(trigger,false);
      }
    } finally {
      installing=false;primary.disabled=false;byId('pwa-help-native').disabled=false;refreshCopy();
    }
  }
  applyTestReset();
  migrateOnce();
  window.addEventListener('beforeinstallprompt',event => {
    if(typeof event.prompt!=='function') return;
    event.preventDefault();
    if(standalone()) return;
    deferredPrompt=event;
    const p=read(PREF_KEY);
    // A fresh eligible browser event after uninstall is stronger than the old local flag.
    if(p && p.reason==='installed') write(PREF_KEY,{schema:4,reason:'ready',until:0,migratedAt:p.migratedAt || null});
    refreshCopy();maybeShow();
  });
  window.addEventListener('appinstalled',() => recordInstalled('appinstalled'));
  function modeChanged() {
    if(standalone()) {
      trackAppOpen();
      const p=read(PREF_KEY);
      if(!p || p.reason!=='installed' || !validUntil(p)) recordInstalled('standalone');
      else {hideBanner();help.hidden=true;refreshCopy();}
    } else {refreshCopy();maybeShow();}
  }
  if(display.addEventListener) display.addEventListener('change',modeChanged);
  else if(display.addListener) display.addListener(modeChanged);
  window.addEventListener('pageshow',modeChanged);
  window.addEventListener('storage',event => {
    if(event.key===PREF_KEY || event.key===null) {
      if(suppressed()) {hideBanner();if(installedKnown()) help.hidden=true;refreshCopy();}
      else maybeShow();
    } else if(LEGACY_KEYS.includes(event.key)) {
      // Ignore pre-V12 preference changes. V12 deliberately starts from a clean local state.
    }
  });
  window.addEventListener('scroll',() => {
    hasScrolled=hasScrolled || window.scrollY>=100;
    if(raf) return;
    raf=requestAnimationFrame(() => {raf=0;maybeShow();});
  },{passive:true});
  function onResize() {
    clearTimeout(layoutTimer);
    layoutTimer=setTimeout(() => {
      if(!viewportOK()) hideBanner();
      else if(!banner.hidden || !help.hidden) updatePosition();
      else maybeShow();
    },150);
  }
  window.addEventListener('resize',onResize,{passive:true});
  if(window.visualViewport) window.visualViewport.addEventListener('resize',onResize,{passive:true});
  document.addEventListener('visibilitychange',() => {if(document.visibilityState==='visible') maybeShow();});
  byId('pwa-banner-close').addEventListener('click',() => dismiss('close'));
  byId('pwa-banner-later').addEventListener('click',() => dismiss('later'));
  primary.addEventListener('click',() => requestInstall(primary));
  manual.addEventListener('click',() => requestInstall(manual));
  byId('pwa-help-native').addEventListener('click',() => requestInstall(byId('pwa-help-native')));
  byId('pwa-help-close').addEventListener('click',closeHelp);
  byId('pwa-help-done').addEventListener('click',closeHelp);
  document.addEventListener('keydown',event => {
    if(event.key==='Escape' && !help.hidden) {event.preventDefault();closeHelp();}
    else if(event.key==='Escape' && !banner.hidden) {event.preventDefault();dismiss('close');}
  });
  byId('pwa-help-copy').addEventListener('click',async function () {
    const button=this;
    try {await navigator.clipboard.writeText('https://212.su/');button.textContent='Адрес скопирован';}
    catch (_) {
      const address=byId('pwa-help-address-text');const range=document.createRange();range.selectNodeContents(address);
      const sel=window.getSelection();if(sel){sel.removeAllRanges();sel.addRange(range);}button.textContent='Адрес выделен';
    }
    setTimeout(() => {button.textContent='Скопировать адрес';},2500);
  });
  refreshCopy();
  setTimeout(() => {ready=true;hasScrolled=hasScrolled || window.scrollY>=100;maybeShow();},MIN_VISIT_MS);
  const offers=byId('offers');
  if(offers && typeof ResizeObserver==='function') new ResizeObserver(() => {if(ready) maybeShow();}).observe(offers);
  if(standalone()) modeChanged();
  if('serviceWorker' in navigator && window.isSecureContext) {
    setTimeout(() => {
      navigator.serviceWorker.register('/sw-212su.js',{scope:'/',updateViaCache:'none'})
        .then(registration => registration.update())
        .catch(() => { /* Manual fallback doesn't require service-worker installation. */ });
    },1300);
  }
})();
