let allSkinsDB = [];
let inventory = [];
let skinsLoading = true;
let caseIsRunning = false;
let filters = {
  search: "",
  min: 0,
  max: Infinity,
  sort: "desc", // 'asc' or 'desc'
};
let currentPage = 1;
const itemsPerPage = 16;
let selectedChance = 50; // Selected win chance percentage (0.0001-75)
let targetPickNonce = 0;
let lastAutoTargetIndex = -1;
let lastTargetPickNonceApplied = -1;
let lastSelectionKey = "";
let currentActualChance = 0;

let lastRenderedTargetIndex = -2;
let fastModeEnabled = false;

// Telegram Mini App / Payments state
let tgWebApp = null;
let tgInitData = "";
let realBalanceRub = null;
let balancePollTimer = null;
let telegramUserId = null;

let appSkinsReady = false;
let appInventoryReady = false;

function setLoading(visible, text) {
  const el = document.getElementById('app-loading');
  if (!el) return;
  const textEl = el.querySelector('.app-loading__text');
  if (textEl && typeof text === 'string') textEl.textContent = text;
  if (visible) el.classList.remove('is-hidden');
  else el.classList.add('is-hidden');
}

function pickSkinsAroundPrice(targetPrice, count = 30) {
  const t = Number(targetPrice || 0);
  if (!Number.isFinite(t) || t <= 0 || !Array.isArray(allSkinsDB) || allSkinsDB.length === 0) return [];

  const min = Math.max(0.01, t * 0.75);
  const max = t * 1.25;

  let pool = allSkinsDB.filter((s) => {
    const p = Number(s.price || 0);
    return Number.isFinite(p) && p >= min && p <= max;
  });

  if (pool.length < 5) {
    pool = allSkinsDB
      .map((s) => ({ s, d: Math.abs(Number(s.price || 0) - t) }))
      .filter((x) => Number.isFinite(Number(x.s.price || 0)))
      .sort((a, b) => a.d - b.d)
      .slice(0, 50)
      .map((x) => x.s);
  }

  const result = [];
  for (let i = 0; i < count; i++) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) result.push(pick);
  }
  return result;
}

function openConsolationCase(lostValue) {
  return new Promise((resolve) => {
    if (caseIsRunning) {
      resolve(null);
      return;
    }

    const overlay = document.getElementById('case-overlay');
    const track = document.getElementById('case-reel-track');
    const title = document.getElementById('case-title');
    const subtitle = document.getElementById('case-subtitle');
    const claimBtn = document.getElementById('case-claim');

    if (!overlay || !track || !claimBtn || !title || !subtitle) {
      resolve(null);
      return;
    }

    caseIsRunning = true;
    const targetPrice = Math.max(0.01, Number(lostValue || 0) * 0.01);
    const reelSkins = pickSkinsAroundPrice(targetPrice, 34);
    if (reelSkins.length === 0) {
      caseIsRunning = false;
      resolve(null);
      return;
    }

    title.textContent = 'Утешительный кейс';
    subtitle.textContent = `Скины примерно по ${targetPrice.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
    claimBtn.style.display = 'none';

    track.innerHTML = '';
    reelSkins.forEach((skin) => {
      const item = document.createElement('div');
      item.className = 'case-item';

      const img = document.createElement('img');
      img.src = skin.img;
      img.alt = '';
      item.appendChild(img);

      const price = document.createElement('div');
      price.className = 'case-price';
      price.textContent = `${Number(skin.price || 0).toLocaleString('ru-RU')} ₽`;
      item.appendChild(price);

      track.appendChild(item);
    });

    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('is-open'));

    const winnerIndex = reelSkins.length - 6;
    const winner = reelSkins[winnerIndex];

    const computeOffset = () => {
      const itemEl = track.children[winnerIndex];
      if (!itemEl) return 0;
      const reelRect = overlay.querySelector('.case-reel')?.getBoundingClientRect();
      const itemRect = itemEl.getBoundingClientRect();
      if (!reelRect) return 0;
      const reelCenter = reelRect.left + reelRect.width / 2;
      const itemCenter = itemRect.left + itemRect.width / 2;
      return reelCenter - itemCenter;
    };

    track.style.transition = 'none';
    track.style.transform = 'translateX(0px)';
    track.getBoundingClientRect();

    const baseOffset = computeOffset();
    const jitter = (Math.random() * 20 - 10);
    const finalOffset = baseOffset + jitter;

    track.style.transition = 'transform 4200ms cubic-bezier(0.12, 0.82, 0.18, 1)';
    track.style.transform = `translateX(${finalOffset}px)`;

    const finish = () => {
      subtitle.textContent = `Ваш скин: ${winner?.name || ''} (${Number(winner?.price || 0).toLocaleString('ru-RU')} ₽)`;
      claimBtn.style.display = 'block';
      claimBtn.disabled = false;

      const cleanup = () => {
        overlay.classList.remove('is-open');
        setTimeout(() => {
          overlay.style.display = 'none';
          caseIsRunning = false;
          resolve(winner || null);
        }, 180);
      };

      const onClaim = () => {
        claimBtn.removeEventListener('click', onClaim);
        cleanup();
      };

      claimBtn.addEventListener('click', onClaim);
    };

    const onEnd = (e) => {
      if (e.propertyName !== 'transform') return;
      track.removeEventListener('transitionend', onEnd);
      finish();
    };

    track.addEventListener('transitionend', onEnd);
  });
}

function maybeHideLoading() {
  if (appSkinsReady && appInventoryReady) {
    setLoading(false);
  }
}

function preventMobileZoom() {
  // Prevent double-tap zoom
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        e.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false },
  );

  // iOS pinch zoom gesture
  document.addEventListener(
    'gesturestart',
    (e) => {
      e.preventDefault();
    },
    { passive: false },
  );
}

function initTelegramWebApp() {
  try {
    if (window.Telegram && window.Telegram.WebApp) {
      tgWebApp = window.Telegram.WebApp;
      tgWebApp.ready();
      tgInitData = tgWebApp.initData || "";
      telegramUserId = tgWebApp?.initDataUnsafe?.user?.id || null;
      const name =
        tgWebApp?.initDataUnsafe?.user?.first_name ||
        tgWebApp?.initDataUnsafe?.user?.username ||
        "Пользователь";
      const nameEl = document.getElementById("tg-name");
      if (nameEl) nameEl.textContent = name;
    }
  } catch (e) {
    console.error("Failed to init Telegram WebApp:", e);
  }
}

async function persistCurrentInventory() {
  if (!tgInitData) return;
  const itemsToSave = inventory.map((it) => ({
    name: it.name,
    img: it.img,
    price: Number(it.price || 0),
  }));

  const saved = await setInventory(itemsToSave);
  inventory = saved.map((it, i) => ({
    name: it.name,
    img: it.img,
    price: Number(it.price || 0),
    id: Date.now() + i,
  }));
}

async function fetchTelegramProfile() {
  if (!tgInitData) return;
  try {
    const res = await fetch("/.netlify/functions/get_profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tgInitData }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Не удалось получить профиль");

    const nameEl = document.getElementById("tg-name");
    if (nameEl && data.name) nameEl.textContent = data.name;

    const drawerNameEl = document.getElementById("drawer-name");
    if (drawerNameEl && data.name) drawerNameEl.textContent = data.name;

    const avatarEl = document.getElementById("tg-avatar");
    const headerAvatarEl = document.getElementById("header-avatar");
    const drawerAvatarEl = document.getElementById("drawer-avatar");
    if (avatarEl) {
      if (data.photo_url) {
        avatarEl.src = data.photo_url;
        avatarEl.style.display = "block";
      } else {
        avatarEl.style.display = "none";
      }
    }

    if (headerAvatarEl) {
      if (data.photo_url) {
        headerAvatarEl.src = data.photo_url;
        headerAvatarEl.style.display = "block";
      } else {
        headerAvatarEl.style.display = "none";
      }
    }

    if (drawerAvatarEl) {
      if (data.photo_url) {
        drawerAvatarEl.src = data.photo_url;
        drawerAvatarEl.style.display = "block";
      } else {
        drawerAvatarEl.style.display = "none";
      }
    }
  } catch (e) {
    console.error("Failed to fetch telegram profile:", e);
  }
}

function pickSkinsForDeposit(depositRub, count = 5) {
  const target = Math.max(1, Number(depositRub || 0) / count);
  const max = target * 1.05;

  // Find skins around target price
  let candidates = allSkinsDB.filter((s) => s.price >= target && s.price <= max);
  if (candidates.length === 0) {
    // fallback: nearest by absolute distance
    candidates = allSkinsDB
      .map((s) => ({ s, d: Math.abs(s.price - target) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 50)
      .map((x) => x.s);
  }

  const rnd = mulberry32(Math.floor(target * 1000) ^ (Number(telegramUserId || 1) >>> 0));
  const items = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rnd() * candidates.length);
    const skin = candidates[idx] || candidates[0] || allSkinsDB[0];
    items.push({
      name: skin?.name || `Skin #${i + 1}`,
      img: skin?.img || "",
      price: Math.round(target),
    });
  }
  return items;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function generateInventoryItems(count) {
  const pool = allSkinsDB.filter((s) => s.price >= 200);
  const list = pool.length > 0 ? pool : allSkinsDB;
  const seedBase = Number(telegramUserId || 1);
  const rnd = mulberry32(seedBase);

  const items = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rnd() * list.length);
    const skin = list[idx] || list[0];
    items.push({
      name: skin?.name || `Skin #${i + 1}`,
      img: skin?.img || "",
      price: 200,
    });
  }
  return items;
}

async function fetchInventory() {
  if (!tgInitData) return [];
  const res = await fetch("/.netlify/functions/get_inventory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData: tgInitData }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Не удалось получить инвентарь");
  return Array.isArray(data.items) ? data.items : [];
}

async function setInventory(items) {
  const res = await fetch("/.netlify/functions/set_inventory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData: tgInitData, items }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Не удалось сохранить инвентарь");
  return Array.isArray(data.items) ? data.items : [];
}

async function syncInventoryFromDeposits() {
  try {
    if (!tgInitData) return;

    // Wait until skins DB is loaded, otherwise we can't pick skins deterministically
    if (skinsLoading || !Array.isArray(allSkinsDB) || allSkinsDB.length === 0) {
      setTimeout(() => {
        syncInventoryFromDeposits();
      }, 500);
      return;
    }

    const current = await fetchInventory();
    let items = current;

    const depRes = await fetch("/.netlify/functions/get_pending_deposits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tgInitData }),
    });
    const depData = await depRes.json();
    if (!depRes.ok) throw new Error(depData?.error || "Не удалось получить депозиты");

    const deposits = Array.isArray(depData.deposits) ? depData.deposits : [];
    if (deposits.length > 0) {
      const processedIds = [];
      deposits.forEach((d) => {
        const rub = Number(d.amount_rub || 0);
        const newSkins = pickSkinsForDeposit(rub, 5);
        items = items.concat(newSkins);
        processedIds.push(d.invoice_id);
      });

      items = await setInventory(items);

      await fetch("/.netlify/functions/mark_deposits_processed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: tgInitData, invoice_ids: processedIds }),
      });
    }

    inventory = items.map((it, i) => ({
      name: it.name,
      img: it.img,
      price: Number(it.price || 0),
      id: Date.now() + i,
    }));

    renderInventory();
    await fetchRealBalance();
    updateUI();
    renderMarket();

    appInventoryReady = true;
    maybeHideLoading();
  } catch (e) {
    console.error("Failed to sync inventory:", e);
  }
}

function setBalanceUI(value) {
  const next = Number(value || 0);
  const balEl = document.getElementById("user-balance");
  const drawerBalEl = document.getElementById("drawer-balance");
  const topupBalEl = document.getElementById("topup-balance");

  const applyText = (el, num) => {
    if (!el) return;
    el.textContent = Number(num || 0).toLocaleString("ru-RU");
  };

  // animate only if we have previous
  const prev = typeof setBalanceUI._last === 'number' ? setBalanceUI._last : null;
  setBalanceUI._last = next;

  const animateTo = (el) => {
    if (!el) return;
    el.classList.add('balance-anim');
    if (prev === null) {
      applyText(el, next);
      return;
    }

    const diff = next - prev;
    el.classList.remove('is-up', 'is-down');
    if (diff > 0) el.classList.add('is-up');
    if (diff < 0) el.classList.add('is-down');

    const start = prev;
    const end = next;
    const duration = 420;
    const t0 = performance.now();

    const step = (t) => {
      const p = Math.min((t - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = start + (end - start) * eased;
      applyText(el, cur);
      if (p < 1) requestAnimationFrame(step);
      else {
        applyText(el, end);
        setTimeout(() => el.classList.remove('is-up', 'is-down'), 500);
      }
    };
    requestAnimationFrame(step);
  };

  animateTo(balEl);
  animateTo(drawerBalEl);
  animateTo(topupBalEl);
}

function setDrawerOpen(open) {
  const drawer = document.getElementById('app-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  if (!drawer || !backdrop) return;
  if (open) {
    drawer.classList.add('is-open');
    backdrop.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
  } else {
    drawer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
  }
}

function showPage(name) {
  const main = document.getElementById('main-page');
  const topup = document.getElementById('topup-page');
  if (!main || !topup) return;

  if (name === 'topup') {
    main.classList.remove('is-active');
    topup.classList.add('is-active');
    main.style.display = 'none';
    topup.style.display = 'block';
  } else {
    topup.classList.remove('is-active');
    main.classList.add('is-active');
    topup.style.display = 'none';
    main.style.display = 'block';
  }
}

async function fetchRealBalance() {
  if (!tgInitData) return;
  try {
    const res = await fetch("/.netlify/functions/get_balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tgInitData }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Не удалось получить баланс");
    realBalanceRub = Number(data.balance_rub || 0);
    setBalanceUI(realBalanceRub);
  } catch (e) {
    console.error("Failed to fetch real balance:", e);
  }
}

function startBalancePolling() {
  if (balancePollTimer) clearInterval(balancePollTimer);
  balancePollTimer = setInterval(() => {
    fetchRealBalance();
  }, 5000);

  setTimeout(() => {
    if (balancePollTimer) {
      clearInterval(balancePollTimer);
      balancePollTimer = null;
    }
  }, 2 * 60 * 1000);
}

// State
let selectedInventoryIndices = []; // Массив для выбранных скинов (до 6)
let selectedTargetIndex = -1;
let isSpinning = false;
let uiBlocked = false; // UI block state
let rotation = 0;

// Animated state
let currentAnimatedChance = 0;
let currentAnimatedMultiplier = 0;
let animationReq = null;

async function fetchSkins() {
  try {
    const skinsUrl =
      "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json";
    const pricesUrl = "https://market.csgo.com/api/v2/prices/USD.json";

    // Show loading state
    if (!marketGrid) {
      console.error(
        "Элемент market-grid не найден. Проверьте index.html (id='market-grid')",
      );
      return;
    }
    marketGrid.innerHTML =
      '<div style="color: var(--text-dim); padding: 20px;">Загрузка данных...</div>';

    // 1. Priority: Data from skins_data.js (generated by Python script)
    const localData =
      typeof allSkinsData !== "undefined"
        ? allSkinsData
        : window.allSkinsData || null;

    if (localData && localData.length > 0) {
      console.log("Found local data, length:", localData.length);
      allSkinsDB = localData.map((skin) => ({
        ...skin,
        fullName: skin.fullName || skin.name,
      }));
    }
    // 2. Fallback: Fetch from API
    else {
      console.log(
        "No local data found (allSkinsData undefined or empty), falling back to API...",
      );
      try {
        const [skinsRes, pricesRes] = await Promise.all([
          fetch(skinsUrl),
          fetch(pricesUrl),
        ]);

        if (!skinsRes.ok || !pricesRes.ok)
          throw new Error("API response not ok");

        const skinsData = await skinsRes.json();
        const pricesData = await pricesRes.json();

        const priceMap = {};
        if (pricesData.success && pricesData.items) {
          pricesData.items.forEach((item) => {
            priceMap[item.market_hash_name] = parseFloat(item.price);
          });
        }

        allSkinsDB = skinsData.map((skin) => {
          let price =
            priceMap[skin.name] ||
            getMockPrice(skin.rarity.name, skin.category.name);
          return {
            name: skin.name.replace("★ ", ""),
            fullName: skin.name,
            price: parseFloat(price.toFixed(2)),
            img: skin.image,
            rarity: skin.rarity.name,
            category: skin.category.name,
          };
        });
      } catch (e) {
        console.error("API Fallback failed:", e);
        marketGrid.innerHTML =
          '<div style="color: #ff7675; padding: 20px;">Ошибка: Данные не найдены. Убедитесь, что вы запустили process_skins.py и файл skins_data.js существует.</div>';
        return;
      }
    }

    if (allSkinsDB.length === 0) {
      marketGrid.innerHTML =
        '<div style="color: #ff7675; padding: 20px;">База данных пуста.</div>';
      return;
    }

    // Filter out skins cheaper than 2 rubles
    allSkinsDB = allSkinsDB.filter((skin) => skin.price >= 2);

    console.log("Total skins in DB (after filtering < 2₽):", allSkinsDB.length);

    // Sort
    allSkinsDB.sort((a, b) => b.price - a.price);

    skinsLoading = false;

    appSkinsReady = true;
    maybeHideLoading();

    // Inventory is synced from server based on balance (no random starter items)
    inventory = [];
    renderInventory();
    // Initialize chance selector
    updateChanceButtons();
    renderMarket();
    updateUI();
    updateBalance();
    drawWheel();

    // If balance already loaded, sync inventory now that skins DB is ready
    if (tgInitData && realBalanceRub !== null && realBalanceRub !== undefined) {
      syncInventoryFromDeposits();
    }
  } catch (error) {
    console.error("Critical error in fetchSkins:", error);
    marketGrid.innerHTML =
      '<div style="color: red; padding: 20px;">Критическая ошибка при загрузке.</div>';
  }
}

function getMockPrice(rarity, category) {
  const basePrices = {
    "Consumer Grade": 0.5,
    "Industrial Grade": 1.5,
    "Mil-Spec Grade": 5.0,
    Restricted: 15.0,
    Classified: 45.0,
    Covert: 120.0,
    Extraordinary: 500.0,
    Contraband: 2500.0,
  };
  let price = basePrices[rarity] || 10.0;
  if (category === "Gloves" || category === "Knives") price += 400;
  return price + Math.random() * (price * 0.2);
}

// Audio setup
let audioCtx = null;
function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playTick(volume = 0.1) {
  if (!audioCtx) return;
  
  // Звук "выстрела пупырки" - резкий, короткий с шумом
  const noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.05, audioCtx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  
  // Генерируем белый шум
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = (Math.random() - 0.5) * 2;
  }
  
  const noiseSource = audioCtx.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  
  // Настраиваем фильтр для "хлопка"
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(1000, audioCtx.currentTime);
  filter.Q.setValueAtTime(1, audioCtx.currentTime);
  
  // Короткий тон для "выстрела"
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.01);
  
  // Настраиваем громкость - очень короткий импульс
  gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
  gainNode.gain.linearRampToValueAtTime(volume, audioCtx.currentTime + 0.001); // Мгновенная атака
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.02); // Быстрое затухание
  
  // Соединяем узлы
  noiseSource.connect(filter);
  oscillator.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  // Запускаем
  noiseSource.start(audioCtx.currentTime);
  oscillator.start(audioCtx.currentTime);
  noiseSource.stop(audioCtx.currentTime + 0.02);
  oscillator.stop(audioCtx.currentTime + 0.02);
}

// Elements
const wheelCanvas = document.getElementById("upgrade-wheel");
const wheelPointer = document.getElementById("wheel-pointer");
const ctx = wheelCanvas.getContext("2d");
const rollBtn = document.getElementById("roll-button");
const lightningBtn = document.getElementById("lightning-btn");
const winChanceDisplay = document.getElementById("win-chance");
const displayMultiplier = document.getElementById("display-multiplier");

// DOM Elements
const inventoryGrid = document.getElementById("inventory-grid");
const marketGrid = document.getElementById("market-grid");
const skinSearchMarketInput = document.getElementById("skin-search-market");
const priceMinInput = document.getElementById("price-min");
const priceMaxInput = document.getElementById("price-max");

// Tab elements
const tabButtons = document.querySelectorAll(".tab-btn");
const inventoryTab = document.getElementById("inventory-tab");
const marketTab = document.getElementById("market-tab");

// Glow effect element
const glowEffect = document.getElementById("glow-effect");

// Function to show glow effect
function showGlowEffect(isWin) {
    if (!glowEffect) return;
    
    // Remove existing classes
    glowEffect.classList.remove("win", "loss", "active");
    
    // Add appropriate class
    if (isWin) {
        glowEffect.classList.add("win");
    } else {
        glowEffect.classList.add("loss");
    }
    
    // Show the glow
    setTimeout(() => {
        glowEffect.classList.add("active");
    }, 50);
    
    // Hide after 1 second
    setTimeout(() => {
        glowEffect.classList.remove("active");
    }, 1000);
}

// Snow Effect Canvas
function initMatrixRain() {
    const canvas = document.getElementById('matrix');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Настройка размеров под экран
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resizeCanvas();
    
    // Снежинки
    const snowflakes = [];
    const maxSnowflakes = 50; // Уменьшил с 200 до 50
    
    // Класс снежинки
    class Snowflake {
        constructor() {
            this.reset();
            this.y = Math.random() * canvas.height; // Начальная позиция по всей высоте
        }
        
        reset() {
            this.x = Math.random() * canvas.width;
            this.y = -10;
            this.size = Math.random() * 2 + 0.5; // Уменьшил размер с 1-4 до 0.5-2.5
            this.speed = Math.random() * 0.8 + 0.3; // Уменьшил скорость
            this.wind = Math.random() * 0.3 - 0.15; // Уменьшил ветер
            this.opacity = Math.random() * 0.4 + 0.3; // Уменьшил прозрачность
        }
        
        update() {
            this.y += this.speed;
            this.x += this.wind;
            
            // Уменьшил покачивание
            this.x += Math.sin(this.y * 0.01) * 0.2;
            
            // Сброс снежинки наверх
            if (this.y > canvas.height + 10) {
                this.reset();
            }
            
            // Если снежинка ушла за боковые границы
            if (this.x > canvas.width + 10) {
                this.x = -10;
            } else if (this.x < -10) {
                this.x = canvas.width + 10;
            }
        }
        
        draw() {
            // Рисуем иконку снежинки ❄
            ctx.font = `${this.size * 3}px Arial`;
            ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('❄', this.x, this.y);
        }
    }
    
    // Создаем снежинки
    for (let i = 0; i < maxSnowflakes; i++) {
        snowflakes.push(new Snowflake());
    }
    
    function draw() {
        // Полностью очищаем canvas без следов
        ctx.fillStyle = 'rgba(15, 15, 15, 1)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Обновляем и рисуем снежинки
        snowflakes.forEach(snowflake => {
            snowflake.update();
            snowflake.draw();
        });
    }
    
    // Запускаем анимацию
    setInterval(draw, 30);
    
    // Обработка изменения размера окна
    window.addEventListener('resize', resizeCanvas);
}

// Initialize snow effect
// Initialize matrix rain effect
initMatrixRain();

function resetPointerToTop() {
  if (!wheelPointer) return;
  wheelPointer.style.transition = "transform 600ms cubic-bezier(0.22, 1, 0.36, 1)";
  wheelPointer.style.transform = "rotate(0deg)";
  rotation = 0;
}

function rand01() {
  if (window.crypto && window.crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    return arr[0] / 4294967296;
  }
  return Math.random();
}

function randRange(min, max) {
  if (max <= min) return min;
  return min + rand01() * (max - min);
}
const priceSortSelect = document.getElementById("price-sort");
const paginationContainer = document.getElementById("pagination-container");
const chanceButtons = document.querySelectorAll(".chance-btn");

const uiInputSlot = document
  .getElementById("input-slot")
  .querySelector(".slot-content");
const uiTargetSlot = document
  .getElementById("target-slot")
  .querySelector(".slot-content");

// Init
function init() {
    initTelegramWebApp();
    preventMobileZoom();
    setLoading(true, 'Загрузка...');
    fetchTelegramProfile();
    fetchSkins();
    // Изначально ничего не выбрано
    selectedInventoryIndices = [];
    selectedTargetIndex = -1;
    updateUI();
    updateBalance(); // init balance
    if (!tgInitData) {
      // Allow non-Telegram preview to render without blocking on inventory fetch
      appInventoryReady = true;
      maybeHideLoading();
    } else {
      fetchRealBalance().then(() => {
        syncInventoryFromDeposits();
      });
    }
    drawWheel();
    const wheelPanelEl = document.querySelector('.wheel-panel');
    if (wheelPanelEl) {
      wheelPanelEl.classList.remove('wheel-appear');
      requestAnimationFrame(() => {
        wheelPanelEl.classList.add('wheel-appear');
      });
    }
    setupListeners();
    setUIBlocked(false); // Ensure UI is unblocked at start
}

function updateBalance() {
  if (realBalanceRub === null || realBalanceRub === undefined) {
    setBalanceUI(0);
    return;
  }
  setBalanceUI(realBalanceRub);
}

function setupListeners() {
  const burgerBtn = document.getElementById('burger-btn');
  const drawerClose = document.getElementById('drawer-close');
  const backdrop = document.getElementById('drawer-backdrop');
  const drawerTopup = document.getElementById('drawer-topup');
  const drawerAbout = document.getElementById('drawer-about');
  const drawerRules = document.getElementById('drawer-rules');
  const drawerSupport = document.getElementById('drawer-support');
  const drawerHistory = document.getElementById('drawer-history');

  if (burgerBtn) burgerBtn.addEventListener('click', () => setDrawerOpen(true));
  if (drawerClose) drawerClose.addEventListener('click', () => setDrawerOpen(false));
  if (backdrop) backdrop.addEventListener('click', () => setDrawerOpen(false));

  if (drawerTopup) {
    drawerTopup.addEventListener('click', () => {
      setDrawerOpen(false);
      showPage('topup');
    });
  }

  const placeholder = (title) => alert(`${title}\n\nСделаем эту страницу следующей.`);
  if (drawerAbout) drawerAbout.addEventListener('click', () => placeholder('О нас'));
  if (drawerRules) drawerRules.addEventListener('click', () => placeholder('Правила'));
  if (drawerSupport) drawerSupport.addEventListener('click', () => placeholder('Поддержка'));
  if (drawerHistory) drawerHistory.addEventListener('click', () => placeholder('История'));

  const topupBack = document.getElementById('topup-back');
  if (topupBack) topupBack.addEventListener('click', () => showPage('main'));

  document.querySelectorAll('.topup-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = Number(btn.dataset.usdt || 0);
      const input = document.getElementById('topup-amount');
      if (input && Number.isFinite(v) && v > 0) input.value = String(v);
    });
  });

  const topupCreate = document.getElementById('topup-create');
  if (topupCreate) {
    topupCreate.addEventListener('click', async () => {
      try {
        if (!tgInitData) {
          alert('Откройте приложение внутри Telegram');
          return;
        }
        const input = document.getElementById('topup-amount');
        const amount = Number(input?.value);
        if (!Number.isFinite(amount) || amount <= 0) return;

        topupCreate.disabled = true;
        topupCreate.textContent = 'СОЗДАНИЕ...';

        const res = await fetch('/.netlify/functions/create_invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: tgInitData, amount }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Не удалось создать счет');

        if (data.pay_url) {
          if (tgWebApp && tgWebApp.openLink) tgWebApp.openLink(data.pay_url);
          else window.open(data.pay_url, '_blank');
        }

        startBalancePolling();
        setTimeout(() => {
          fetchRealBalance().then(() => syncInventoryFromDeposits());
        }, 8000);
      } catch (e) {
        console.error(e);
        alert(e?.message || 'Не удалось создать счет');
      } finally {
        topupCreate.disabled = false;
        topupCreate.textContent = 'Создать счёт';
      }
    });
  }

  // Roll Button
  rollBtn.addEventListener("click", () => {
    initAudio();
    spin();
  });

  // Dev deposit button (test issuance of skins without real payment)
  const devDepositBtn = document.getElementById("dev-deposit-btn");
  if (devDepositBtn) {
    if (tgInitData) {
      devDepositBtn.style.display = "inline-block";
    }

    devDepositBtn.addEventListener("click", async () => {
      try {
        if (!tgInitData) {
          alert("Откройте приложение внутри Telegram");
          return;
        }

        const adminSecret = prompt("DEV_ADMIN_SECRET (для теста)");
        if (!adminSecret) return;

        const amountStr = prompt("Тестовый депозит (₽), выдаст +5 скинов по формуле", "1000");
        const amountRub = Number(amountStr);
        if (!Number.isFinite(amountRub) || amountRub <= 0) return;

        devDepositBtn.disabled = true;
        devDepositBtn.textContent = "ДОБАВЛЯЕМ...";

        const res = await fetch("/.netlify/functions/dev_add_deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adminSecret, initData: tgInitData, amount_rub: amountRub }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Тестовый депозит не удался");

        await fetchRealBalance();
        await syncInventoryFromDeposits();
      } catch (e) {
        console.error(e);
        alert(e?.message || "Тест депозита не удался");
      } finally {
        devDepositBtn.disabled = false;
        devDepositBtn.textContent = "ТЕСТ ДЕПОЗИТ (СКИНЫ)";
      }
    });
  }

  // Lightning Button - переключатель быстрого режима
  lightningBtn.addEventListener("click", () => {
    fastModeEnabled = !fastModeEnabled;
    lightningBtn.classList.toggle("active");
  });

  // Ensure page state is consistent on init
  showPage('main');

  // Tab switching
  tabButtons.forEach(button => {
    button.addEventListener("click", (e) => {
      const tabName = e.target.dataset.tab;
      
      // Update button states
      tabButtons.forEach(btn => btn.classList.remove("active"));
      e.target.classList.add("active");
      
      // Smooth tab switching
      const currentTab = document.querySelector(".tab-content.active");
      const targetTab = tabName === "inventory" ? inventoryTab : marketTab;
      
      if (currentTab) {
        currentTab.classList.remove("active");
        setTimeout(() => {
          currentTab.style.display = "none";
          targetTab.style.display = "block";
          setTimeout(() => {
            targetTab.classList.add("active");
          }, 50);
        }, 200);
      } else {
        // Initial state
        targetTab.style.display = "block";
        targetTab.classList.add("active");
      }
    });
  });

  // Filter Event Listeners
  if (skinSearchMarketInput) {
    skinSearchMarketInput.addEventListener("input", (e) => {
      filters.search = e.target.value.toLowerCase();
      currentPage = 1; // Reset to first page on filter change
      renderMarket();
    });
  }

  if (priceMinInput) {
    priceMinInput.addEventListener("input", (e) => {
      filters.min = parseFloat(e.target.value) || 0;
      currentPage = 1; // Reset to first page on filter change
      renderMarket();
    });
  }

  if (priceMaxInput) {
    priceMaxInput.addEventListener("input", (e) => {
      filters.max = parseFloat(e.target.value) || Infinity;
      currentPage = 1; // Reset to first page on filter change
      renderMarket();
    });
  }

  if (priceSortSelect) {
    priceSortSelect.addEventListener("change", (e) => {
      filters.sort = e.target.value;
      currentPage = 1; // Reset to first page on filter change
      renderMarket();
    });
  }

  // Chance selector
  chanceButtons.forEach((button) => {
    button.addEventListener("click", (e) => {
      selectedChance = parseFloat(e.target.dataset.chance);
      updateChanceButtons();
      // Reset target selection when chance changes
      selectedTargetIndex = -1;
      // Force re-pick of target even if chance clicked repeatedly
      targetPickNonce++;
      updateUI();
      drawWheel();
    });
  });
}

function renderSelectedSkins() {
  const grid = document.getElementById('selected-skins-grid');
  grid.innerHTML = '';
  
  const selectedItems = selectedInventoryIndices.map(index => inventory[index]).filter(item => item);

  // Базовый класс сетки
  grid.className = 'selected-skins-grid';

  // Класс по количеству выбранных (нужен для CSS-раскладки)
  grid.classList.remove('count-0', 'count-1', 'count-2', 'count-3', 'count-4', 'count-5', 'count-6');
  const cnt = Math.max(0, Math.min(6, selectedItems.length));
  grid.classList.add(`count-${cnt}`);
  
  // Добавляем выбранные скины
  selectedItems.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'selected-skin-item';
    div.innerHTML = `
      <img src="${item.img}" alt="${item.name}">
      <div class="name">${item.name}</div>
      <div class="price">${item.price.toLocaleString("ru-RU")} ₽</div>
      <div class="remove-skin">×</div>
    `;
    
    // Обработчик удаления скина
    div.querySelector('.remove-skin').onclick = (e) => {
      e.stopPropagation();
      const originalIndex = selectedInventoryIndices[index];
      selectedInventoryIndices = selectedInventoryIndices.filter(i => i !== originalIndex);
      renderInventory();
      updateUI();
      renderMarket();
    };
    
    grid.appendChild(div);
  });
}

function renderInventory() {
  inventoryGrid.innerHTML = "";
  inventory.forEach((item, index) => {
    const isSelected = selectedInventoryIndices.includes(index);
    const div = document.createElement("div");
    div.className = `grid-item ${isSelected ? "active" : ""}`;
    div.innerHTML = `
            <img src="${item.img}">
            <div class="name">${item.name}</div>
            <div class="price">${item.price.toLocaleString("ru-RU")} ₽</div>
            ${isSelected ? `<div class="selected-count">${selectedInventoryIndices.indexOf(index) + 1}</div>` : ''}
        `;
    div.onclick = () => {
        if (isSpinning || uiBlocked) return;
        
        if (isSelected) {
          // Убираем из выбора
          selectedInventoryIndices = selectedInventoryIndices.filter(i => i !== index);
        } else {
          // Добавляем в выбор, если не превышен лимит
          if (selectedInventoryIndices.length < 6) {
            selectedInventoryIndices.push(index);
          } else {
            alert('Можно выбрать максимум 6 скинов');
            return;
          }
        }
        
        selectedTargetIndex = -1; // Reset target when inventory changes
        renderInventory(); // Re-render for active state
        renderMarket(); // Update market to show matching skins
        updateUI();
    };
    inventoryGrid.appendChild(div);
  });

  if (inventory.length === 0) {
    inventoryGrid.innerHTML =
      '<div style="color: grey; padding: 20px;">Инвентарь пуст</div>';
    selectedInventoryIndices = [];
    updateUI();
  }
}

function renderMarket() {
  marketGrid.innerHTML = "";

  if (skinsLoading) {
    return; // Handled in fetchSkins initially
  }

  // Get selected inventory items for chance-based filtering
  const selectedItems = selectedInventoryIndices.map(index => inventory[index]).filter(item => item);
  const invItem = selectedItems.length > 0 ? selectedItems[0] : null;

  // Apply filters
  let filteredSkins = allSkinsDB.filter((skin) => {
    const matchesSearch = skin.name.toLowerCase().includes(filters.search);
    const matchesMin = skin.price >= filters.min;
    const matchesMax = skin.price <= filters.max;

    // If inventory item is selected, highlight matching skins but don't filter them out
    let matchesChance = true;

    return matchesSearch && matchesMin && matchesMax && matchesChance;
  });

  // Apply sorting
  if (filters.sort === "asc") {
    filteredSkins.sort((a, b) => a.price - b.price);
  } else {
    filteredSkins.sort((a, b) => b.price - a.price);
  }

  // Calculate pagination
  const totalPages = Math.ceil(filteredSkins.length / itemsPerPage);

  // Reset to page 1 if current page is out of bounds
  if (currentPage > totalPages && totalPages > 0) {
    currentPage = 1;
  }

  // Get items for current page
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const pageSkins = filteredSkins.slice(startIndex, endIndex);

  // Render items for current page
  pageSkins.forEach((item) => {
    const isSelected =
      selectedTargetIndex !== -1 && allSkinsDB[selectedTargetIndex] === item;

    const div = document.createElement("div");
    div.className = `grid-item ${isSelected ? "active" : ""}`;
    div.innerHTML = `
            <img src="${item.img}">
            <div class="name">${item.name}</div>
            <div class="price">${item.price.toLocaleString("ru-RU")} ₽</div>
        `;
    div.onclick = () => {
        if (isSpinning || uiBlocked) return;
        selectedTargetIndex = allSkinsDB.indexOf(item);
        renderMarket();
        updateUI();
    };
    marketGrid.appendChild(div);
  });

  if (filteredSkins.length === 0) {
    marketGrid.innerHTML =
      '<div style="color: grey; padding: 20px;">Ничего не найдено по фильтрам</div>';
    paginationContainer.innerHTML = "";
  } else {
    renderPagination(totalPages, filteredSkins.length);
  }
}

function renderPagination(totalPages, totalItems) {
  if (totalPages <= 1) {
    paginationContainer.innerHTML = "";
    return;
  }

  let paginationHTML = '<div class="pagination">';

  // Previous button
  paginationHTML += `<button class="pagination-btn" ${currentPage === 1 ? "disabled" : ""} onclick="goToPage(${currentPage - 1})">
        <i class="fas fa-chevron-left"></i>
    </button>`;

  // Page numbers
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  if (startPage > 1) {
    paginationHTML += `<button class="pagination-btn" onclick="goToPage(1)">1</button>`;
    if (startPage > 2) {
      paginationHTML += `<span class="pagination-dots">...</span>`;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    paginationHTML += `<button class="pagination-btn ${i === currentPage ? "active" : ""}" onclick="goToPage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      paginationHTML += `<span class="pagination-dots">...</span>`;
    }
    paginationHTML += `<button class="pagination-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }

  // Next button
  paginationHTML += `<button class="pagination-btn" ${currentPage === totalPages ? "disabled" : ""} onclick="goToPage(${currentPage + 1})">
        <i class="fas fa-chevron-right"></i>
    </button>`;

  paginationHTML += "</div>";

  // Page info
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);
  paginationHTML += `<div class="pagination-info">Показано ${startItem}-${endItem} из ${totalItems}</div>`;

  paginationContainer.innerHTML = paginationHTML;
}

function goToPage(page) {
  if (page < 1) return;
  currentPage = page;
  renderMarket();
  // Scroll to top of market grid
  marketGrid.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Make goToPage available globally for onclick handlers
window.goToPage = goToPage;

// Navigate to the page containing the target skin
function navigateToTargetPage(targetItem) {
  if (!targetItem || skinsLoading) return;
  
  // Apply current filters to get all filtered skins
  const selectedItems = selectedInventoryIndices.map(index => inventory[index]).filter(item => item);
  const invItem = selectedItems.length > 0 ? selectedItems[0] : null;
  
  let filteredSkins = allSkinsDB.filter((skin) => {
    const matchesSearch = skin.name.toLowerCase().includes(filters.search);
    const matchesMin = skin.price >= filters.min;
    const matchesMax = skin.price <= filters.max;
    return matchesSearch && matchesMin && matchesMax;
  });
  
  // Apply sorting
  if (filters.sort === "asc") {
    filteredSkins.sort((a, b) => a.price - b.price);
  } else {
    filteredSkins.sort((a, b) => b.price - a.price);
  }
  
  // Find the index of target item in filtered list
  const targetIndex = filteredSkins.findIndex(skin => skin === targetItem);
  
  if (targetIndex !== -1) {
    // Calculate which page the target is on
    const targetPage = Math.floor(targetIndex / itemsPerPage) + 1;
    const totalPages = Math.ceil(filteredSkins.length / itemsPerPage);
    
    // Only navigate if it's a different page
    if (targetPage !== currentPage && targetPage <= totalPages) {
      currentPage = targetPage;
      renderMarket();
    }
  }
}

function updateUI() {
  // Fast mode toggle should stay clickable вне спина
  if (lightningBtn && !isSpinning && !uiBlocked) {
    lightningBtn.disabled = false;
  }

  // Получаем выбранные скины
  const selectedItems = selectedInventoryIndices.map(index => inventory[index]).filter(item => item);
  const selectionKey = selectedInventoryIndices.slice().sort((a, b) => a - b).join(',');
  
  // Автоматический подбор цели для апгрейда (рандомный среди подходящих)
  // Меняем цель ТОЛЬКО когда:
  // - ты нажал на шанс (targetPickNonce меняется)
  // - ты изменил набор выбранных скинов
  let targetItem = null;
  if (selectedItems.length === 0) {
    selectedTargetIndex = -1;
  } else {
    const shouldRepick =
      targetPickNonce !== lastTargetPickNonceApplied || selectionKey !== lastSelectionKey;

    // Если не нужно репикать — пробуем оставить текущий target
    if (!shouldRepick && selectedTargetIndex !== -1) {
      targetItem = allSkinsDB[selectedTargetIndex] || null;
    }

    if (shouldRepick || !targetItem) {
      const totalValue = selectedItems.reduce((sum, item) => sum + item.price, 0);
      const expectedTargetPrice = (100 * totalValue) / selectedChance;
      
      // Dynamic tolerance based on chance (same as in spin function)
      let toleranceMultiplier;
      if (selectedChance < 0.01) {
        toleranceMultiplier = 0.5; // 50% tolerance for very small chances
      } else if (selectedChance < 0.1) {
        toleranceMultiplier = 0.3; // 30% tolerance for small chances
      } else {
        toleranceMultiplier = 0.2; // 20% tolerance for normal chances
      }
      const tolerance = expectedTargetPrice * toleranceMultiplier;

      const candidates = allSkinsDB
        .map((skin, idx) => ({ skin, idx }))
        .filter(({ skin }) => {
          // Проверяем, что цена скина соответствует ожидаемой
          const matchesPrice = Math.abs(skin.price - expectedTargetPrice) <= tolerance;
          // Дополнительно проверяем, что шанс не превышает 75%
          const chanceWithThisSkin = (totalValue / skin.price) * 100;
          const chanceNotTooHigh = chanceWithThisSkin <= 75;
          return matchesPrice && chanceNotTooHigh;
        });

      if (candidates.length > 0) {
        // Try not to repeat the same target twice if possible
        let pool = candidates;
        if (candidates.length > 1 && lastAutoTargetIndex !== -1) {
          const filtered = candidates.filter(({ idx }) => idx !== lastAutoTargetIndex);
          if (filtered.length > 0) pool = filtered;
        }

        const pick = pool[Math.floor(Math.random() * pool.length)];
        targetItem = pick.skin;
        selectedTargetIndex = pick.idx;
        lastAutoTargetIndex = pick.idx;

        lastTargetPickNonceApplied = targetPickNonce;
        lastSelectionKey = selectionKey;
        
        // Auto-navigate to the page with the winning skin
        navigateToTargetPage(targetItem);
      } else {
        targetItem = null;
        selectedTargetIndex = -1;
        lastTargetPickNonceApplied = targetPickNonce;
        lastSelectionKey = selectionKey;
      }
    }
  }

  // Your Offer: всегда квадратный, а скины внутри сжимаются под сетку
  const inputSlot = document.getElementById('input-slot');
  inputSlot.classList.add('offer-square');

  // Обновляем динамическую сетку выбранных скинов
  renderSelectedSkins();

  // selection-info removed

  const targetImgEl = document.getElementById("target-skin-img");
  const targetNameEl = document.getElementById("target-skin-name");
  const targetPriceEl = document.getElementById("target-skin-price");
  const targetDisplayEl = document.querySelector("#target-slot .target-display");

  const nextTargetIndex = targetItem ? selectedTargetIndex : -1;
  const shouldAnimateTarget = nextTargetIndex !== lastRenderedTargetIndex;

  const applyTargetDom = () => {
    if (targetItem) {
      uiTargetSlot.className = "slot-content";
      if (targetImgEl) {
        targetImgEl.src = targetItem.img;
        targetImgEl.alt = targetItem.name;
        targetImgEl.style.display = "block";
      }
      if (targetNameEl) targetNameEl.textContent = targetItem.name;
      if (targetPriceEl)
        targetPriceEl.textContent = targetItem.price.toLocaleString("ru-RU");
    } else {
      uiTargetSlot.className = "slot-content empty";
      if (targetImgEl) {
        targetImgEl.src = "";
        targetImgEl.alt = "";
        targetImgEl.style.display = "none";
      }
      if (targetNameEl) targetNameEl.textContent = "Цель не выбрана";
      if (targetPriceEl) targetPriceEl.textContent = "0";
    }
    lastRenderedTargetIndex = nextTargetIndex;
  };

  if (!shouldAnimateTarget || !targetDisplayEl) {
    applyTargetDom();
  } else {
    targetDisplayEl.classList.add("is-fading");
    setTimeout(() => {
      applyTargetDom();
      requestAnimationFrame(() => {
        targetDisplayEl.classList.remove("is-fading");
      });
    }, 160);
  }

  if (selectedItems.length === 0) {
    rollBtn.disabled = true;
    rollBtn.textContent = "ВЫБЕРИТЕ СКИНЫ";
    winChanceDisplay.textContent = "0.00";
    displayMultiplier.textContent = "0.00";
    return;
  }

  if (!targetItem || selectedTargetIndex === -1) {
    rollBtn.disabled = true;
    rollBtn.textContent = "НЕТ ЦЕЛИ";
    return;
  }

  // Use selected chance
  const totalValue = selectedItems.reduce((sum, item) => sum + item.price, 0);

  // Multiplier считается от реальной цены target (если есть)
  // chance = (totalValue / targetPrice) * 100
  // multiplier = targetPrice / totalValue
  let chance = selectedChance;
  let multiplier = 100 / selectedChance;
  if (targetItem && totalValue > 0) {
    multiplier = targetItem.price / totalValue;
    chance = (totalValue / targetItem.price) * 100;
  }

  // Clamp and store actual chance for spin logic
  chance = Math.max(0.0001, Math.min(chance, 99.99));
  currentActualChance = chance;

  // Trigger animation
  animateValues(chance, multiplier);

  // Enable button if chance is valid (0.0001-75%)
  if (chance >= 0.0001 && chance <= 75) {
    rollBtn.disabled = false;
    rollBtn.textContent = "АПГРЕЙД";
  } else {
    rollBtn.disabled = true;
    rollBtn.textContent = "ШАНС < 0.0001%";
  }
}

function updateChanceButtons() {
  chanceButtons.forEach((button) => {
    const btnChance = parseFloat(button.dataset.chance);
    if (btnChance === selectedChance) {
      button.classList.add("active");
    } else {
      button.classList.remove("active");
    }
  });
}

function calculateChance() {
    // Use actual chance if we have it, otherwise fallback to selectedChance
    return currentActualChance > 0 ? currentActualChance : selectedChance;
}

// Function to block/unblock UI
function setUIBlocked(blocked) {
  uiBlocked = blocked;
  const interactiveElements = document.querySelectorAll(
    "button:not(#roll-button):not(#lightning-btn):not(.burger-btn):not(.drawer-btn):not(.drawer-close):not(.topup-back):not(.topup-cta):not(.topup-preset), input:not(.topup-input), select, .grid-item, .slot-card",
  );
  interactiveElements.forEach((el) => {
    if (blocked) {
      el.classList.add("ui-blocked");
      el.disabled = true;
      el.style.pointerEvents = "none";
      if (el.classList.contains("grid-item")) {
        el.style.filter = "grayscale(0.3)";
      }
    } else {
      el.classList.remove("ui-blocked");
      el.disabled = false;
      el.style.pointerEvents = "auto";
      el.style.filter = "none";
    }
  });

  const rollBtn = document.getElementById("roll-button");
  if (rollBtn) {
    rollBtn.style.opacity = blocked ? "0.6" : "1";
    rollBtn.style.cursor = blocked ? "not-allowed" : "pointer";
  }

  const marketFilters = document.querySelector(".market-filters");
  if (marketFilters) {
    marketFilters.style.opacity = blocked ? "0.5" : "1";
  }

  document.querySelectorAll(".chance-btn").forEach((btn) => {
    btn.disabled = blocked;
    btn.style.opacity = blocked ? "0.5" : "1";
  });

  console.log(blocked ? "UI заблокирован во время спина" : "UI разблокирован");
}

// Format chance value for display
function formatChance(chance) {
  if (chance < 0.01) {
    // Для очень маленьких значений показываем научную нотацию или много знаков
    return chance.toExponential(2);
  } else if (chance < 1) {
    // Для значений меньше 1% показываем 4 знака после запятой
    return chance.toFixed(4);
  } else if (chance < 10) {
    // Для значений от 1% до 10% показываем 2 знака после запятой
    return chance.toFixed(2);
  } else {
    // Для больших значений показываем 1 знак после запятой
    return chance.toFixed(1);
  }
}

// Format multiplier value for display
function formatMultiplier(multiplier) {
  if (multiplier < 1) {
    return multiplier.toFixed(2);
  } else if (multiplier < 10) {
    return multiplier.toFixed(1);
  } else if (multiplier < 100) {
    return multiplier.toFixed(0);
  } else if (multiplier < 1000) {
    return multiplier.toFixed(0);
  } else {
    // Для очень больших множителей используем научную нотацию
    return multiplier.toExponential(2);
  }
}

// Animate values during spin
function animateValues(targetChance, targetMultiplier) {
  if (animationReq) cancelAnimationFrame(animationReq);

  const step = () => {
    const chanceDiff = targetChance - currentAnimatedChance;
    const multDiff = targetMultiplier - currentAnimatedMultiplier;

    // Apply easing (lerp)
    currentAnimatedChance += chanceDiff * 0.15;
    currentAnimatedMultiplier += multDiff * 0.15;

    // Snapping
    if (Math.abs(chanceDiff) < 0.01) currentAnimatedChance = targetChance;
    if (Math.abs(multDiff) < 0.001)
      currentAnimatedMultiplier = targetMultiplier;

    // Update displays
    winChanceDisplay.textContent = formatChance(currentAnimatedChance);
    displayMultiplier.textContent = formatMultiplier(currentAnimatedMultiplier);

    // Redraw wheel with animated chance
    drawWheel();

    if (
      currentAnimatedChance !== targetChance ||
      currentAnimatedMultiplier !== targetMultiplier
    ) {
      animationReq = requestAnimationFrame(step);
    } else {
      animationReq = null;
    }
  };

  animationReq = requestAnimationFrame(step);
}

function drawWheel() {
  const w = wheelCanvas.width;
  const h = wheelCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = w / 2 - 10;
  // Use animated value if available, otherwise use selected chance
  const chance =
    currentAnimatedChance > 0 ? currentAnimatedChance : selectedChance;
  const startAngle = -Math.PI / 2; // Top 12 o'clock

  const winAngleLength = (chance / 100) * (Math.PI * 2);

  ctx.clearRect(0, 0, w, h);

  // Background (Loss)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#1e1e24";
  ctx.fill();
  ctx.strokeStyle = "#2d3436";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Win Zone
  if (chance > 0) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);

    ctx.arc(cx, cy, r, startAngle, startAngle + winAngleLength);
    ctx.lineTo(cx, cy);

    const grad = ctx.createRadialGradient(cx, cy, r / 4, cx, cy, r);
    grad.addColorStop(0, "#4a4a4a");
    grad.addColorStop(1, "#6a6a6a");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.shadowBlur = 10;
    ctx.shadowColor = "#4a4a4a";
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // DRAW TICK MARKS (Ruler Scale)
  const tickCount = 120;
  for (let i = 0; i < tickCount; i++) {
    const angle = (i / tickCount) * Math.PI * 2;
    const isMajor = i % 5 === 0;

    const tickLength = isMajor ? 12 : 6;
    const innerR = r - tickLength;
    const outerR = r;

    const x1 = cx + Math.cos(angle) * innerR;
    const y1 = cy + Math.sin(angle) * innerR;
    const x2 = cx + Math.cos(angle) * outerR;
    const y2 = cy + Math.sin(angle) * outerR;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = isMajor
      ? "rgba(255,255,255,0.5)"
      : "rgba(255,255,255,0.2)";
    ctx.lineWidth = isMajor ? 2 : 1;
    ctx.stroke();
  }
}

function spinSmooth() {
    if (isSpinning || selectedInventoryIndices.length === 0 || uiBlocked) return;

    // Validate chance before spinning
    const chance = calculateChance();
    if (chance > 75 || chance < 0.0001) {
        console.warn("Нельзя крутить: шанс некорректен");
        return;
    }

    // Validate that we have selected items and target
    const selectedItems = selectedInventoryIndices.map(index => inventory[index]).filter(item => item);
    if (selectedItems.length === 0) return;

    // Block UI
    setUIBlocked(true);
    isSpinning = true;
    rollBtn.disabled = true;
    lightningBtn.disabled = true;
    
    rollBtn.innerHTML = "КРУТИМ...";

    // Determine desired result based on chance
    const desiredWin = rand01() * 100 <= chance;
    const winZoneDeg = (chance / 100) * 360;
    let targetAngle;

    if (desiredWin) {
        const margin = Math.min(1, winZoneDeg * 0.15);
        const start = margin;
        const end = Math.max(start, winZoneDeg - margin);
        targetAngle = randRange(start, end);
    } else {
        const lossZoneSize = 360 - winZoneDeg;
        const margin = Math.min(1, lossZoneSize * 0.02);
        const start = margin;
        const end = Math.max(start, lossZoneSize - margin);
        const randomLossPos = randRange(start, end);
        targetAngle = winZoneDeg + randomLossPos;
        if (targetAngle >= 360) {
            targetAngle = targetAngle - 360;
        }
    }

    // Быстрая прокрутка: 1 полный оборот + случайная точка
    const startRotation = rotation;
    const spins = 1; // Один полный оборот
    const endRotation = startRotation + (spins * 360) + targetAngle;
    const duration = 1000; // 1 секунда
    const startTime = performance.now();

    function animateSmooth(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Плавное easing для красивого перемещения
        const ease = 1 - Math.pow(1 - progress, 3);
        
        const currentRotation = startRotation + (endRotation - startRotation) * ease;
        rotation = currentRotation;
        wheelPointer.style.transform = `rotate(${rotation}deg)`;

        if (progress < 1) {
            requestAnimationFrame(animateSmooth);
        } else {
            // Финальный результат
            const finalAngle = normalizeAngle(rotation);
            const actualWin = checkIfWin(finalAngle, winZoneDeg);
            handleResult(actualWin);
            setTimeout(resetPointerToTop, 150);
        }
    }

    // Отключаем CSS переход для JavaScript анимации
    wheelPointer.style.transition = "none";
    requestAnimationFrame(animateSmooth);
}

function spin() {
    if (isSpinning || selectedInventoryIndices.length === 0 || uiBlocked) return;

    // Don't allow spin without target
    if (selectedTargetIndex === -1) {
        rollBtn.disabled = true;
        rollBtn.textContent = "НЕТ ЦЕЛИ";
        return;
    }

    // Validate chance before spinning
    const chance = calculateChance();
    if (chance > 75 || chance < 0.0001) {
        console.warn("Cannot spin: chance is invalid");
        return;
    }

    // Если включен быстрый режим - используем плавную анимацию
    if (fastModeEnabled) {
        spinSmooth();
        return;
    }

  // Validate that we have selected items and target
  const selectedItems = selectedInventoryIndices.map(index => inventory[index]).filter(item => item);
  if (selectedItems.length === 0) return;
  
  const totalValue = selectedItems.reduce((sum, item) => sum + item.price, 0);

  // If target is selected, verify it matches the chance and doesn't exceed 75%
  if (selectedTargetIndex !== -1) {
    const targetItem = allSkinsDB[selectedTargetIndex];
    if (targetItem) {
      const totalValue = selectedItems.reduce((sum, item) => sum + item.price, 0);
      const actualChance = (totalValue / targetItem.price) * 100;
      
      // Check that chance doesn't exceed 75%
      if (actualChance > 75) {
        console.warn("Target item gives chance higher than 75%");
        return;
      }
      
      const expectedPrice = (100 * totalValue) / chance;
      const priceDiff =
        Math.abs(targetItem.price - expectedPrice) / expectedPrice;
      
      // Dynamic tolerance based on chance
      let tolerance;
      if (chance < 0.01) {
        tolerance = 0.5; // 50% tolerance for very small chances
      } else if (chance < 0.1) {
        tolerance = 0.3; // 30% tolerance for small chances
      } else {
        tolerance = 0.2; // 20% tolerance for normal chances
      }
      
      if (priceDiff > tolerance) {
        console.warn(`Target item doesn't match chance. Tolerance: ${(tolerance * 100).toFixed(0)}%, Actual diff: ${(priceDiff * 100).toFixed(2)}%`);
        return;
      }
    }
  }

  // Block UI
  setUIBlocked(true);

  isSpinning = true;
  rollBtn.disabled = true;
  lightningBtn.disabled = true;
  
  rollBtn.innerHTML = "КРУТИМ...";

  // Determine desired result based on chance
  const desiredWin = rand01() * 100 <= chance;

  // Win zone starts at 0 degrees and goes clockwise
  // Win zone in degrees: from 0 to winZoneDeg
  const winZoneDeg = (chance / 100) * 360;
  let targetAngle;

  if (desiredWin) {
    // Land inside win zone (with small padding from edges to avoid boundary issues)
    const margin = Math.min(1, winZoneDeg * 0.15);
    const start = margin;
    const end = Math.max(start, winZoneDeg - margin);
    targetAngle = randRange(start, end);
  } else {
    // Land outside win zone
    // Loss zone size: 360 - winZoneDeg
    const lossZoneSize = 360 - winZoneDeg;
    const margin = Math.min(1, lossZoneSize * 0.02);
    const start = margin;
    const end = Math.max(start, lossZoneSize - margin);
    const randomLossPos = randRange(start, end);
    // Position after win zone ends
    targetAngle = winZoneDeg + randomLossPos;
    // Normalize if exceeds 360
    if (targetAngle >= 360) {
      targetAngle = targetAngle - 360;
    }
  }

  // Normalize start rotation to 0-360
  const normalizedStartRotation = normalizeAngle(rotation);

  const spins = 8 + Math.floor(rand01() * 3);
  // Calculate total rotation needed to reach target angle from current position
  // We want: (normalizedStartRotation + totalRotation) % 360 = targetAngle
  let totalRotation = targetAngle - normalizedStartRotation;
  if (totalRotation < 0) {
    totalRotation += 360;
  }
  totalRotation += spins * 360; // Add full spins

  const startRotation = rotation;
  const endRotation = rotation + totalRotation;
  const duration = 8000;
  const startTime = performance.now();

  let lastTickAngle = 0;
  const tickInterval = 15; // Play sound every 15 degrees

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Плавный разгон -> максимальная скорость -> плавное торможение
    const ease =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    const currentRotation = startRotation + totalRotation * ease;
    rotation = currentRotation;
    wheelPointer.style.transform = `rotate(${rotation}deg)`;

    // Sound logic
    if (Math.abs(currentRotation - lastTickAngle) >= tickInterval) {
      playTick(0.1 * (1 - progress)); // Fade sound slightly as it slows
      lastTickAngle = currentRotation;
    }

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Calculate actual result based on final angle
      const finalAngle = normalizeAngle(rotation);
      rotation = finalAngle;
      wheelPointer.style.transition = "none";
      wheelPointer.style.transform = `rotate(${rotation}deg)`;

      const actualWin = checkIfWin(finalAngle, winZoneDeg);
      handleResult(actualWin);
      setTimeout(resetPointerToTop, 150);
    }
  }

  // Disable CSS transition for manual animation
  wheelPointer.style.transition = "none";
  requestAnimationFrame(animate);
}

// Normalize angle to 0-360 range
function normalizeAngle(angle) {
  let normalized = angle % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

// Check if the final angle is in the win zone
// Зона выигрыша начинается с 0 градусов и идёт по часовой стрелке
function checkIfWin(finalAngle, winZoneDeg) {
  // Зона выигрыша начинается с 0 градусов (верхняя точка)
  const winZoneStart = 0; // Начало зоны выигрыша
  const winZoneEnd = winZoneDeg; // Конец зоны выигрыша

  // Нормализуем финальный угол в 0-360 диапазон
  const normalizedFinal = finalAngle % 360;
  if (normalizedFinal < 0) normalizedFinal += 360;

  // Выигрыш если угол находится в зоне от 0 до winZoneDeg
  const isWin = normalizedFinal >= winZoneStart && normalizedFinal < winZoneEnd;
  
  return isWin;
}

function handleResult(isWin) {
  isSpinning = false;
  setUIBlocked(false); // Unblock UI immediately after spin stops
  
  // Show glow effect
  showGlowEffect(isWin);

  // Validate selected items before proceeding
  const selectedItems = selectedInventoryIndices.map(index => inventory[index]).filter(item => item);
  const targetItem = allSkinsDB[selectedTargetIndex];

  if (selectedItems.length === 0 || !targetItem) {
    console.error("Invalid items in handleResult");
    rollBtn.className = "roll-btn";
    rollBtn.disabled = false;
    lightningBtn.disabled = false;
    rollBtn.innerHTML = "ВЫБЕРИТЕ СКИНЫ";
    updateUI();
    return;
  }

  // Feedback on Button
  rollBtn.classList.remove("btn-win", "btn-loss"); // reset first
  if (isWin) {
    rollBtn.classList.add("btn-win");
    rollBtn.innerHTML = "ВЫ ВЫИГРАЛИ!";
  } else {
    rollBtn.classList.add("btn-loss");
    rollBtn.innerHTML = "ВЫ ПРОИГРАЛИ!";
  }
  
  // Разблокировать кнопку-молнию
  lightningBtn.disabled = false;

  if (isWin) {
    // Remove all selected items and add the target item
    selectedInventoryIndices.sort((a, b) => b - a); // Sort descending to remove from end
    selectedInventoryIndices.forEach(index => {
      inventory.splice(index, 1);
    });
    
    // Add the target item
    inventory.unshift({ ...targetItem, id: Date.now() });
    
    // Clear selection
    selectedInventoryIndices = [];
    selectedTargetIndex = -1;

    // Force render immediately
    renderInventory();
    updateUI();

    persistCurrentInventory()
      .then(() => {
        return fetchRealBalance();
      })
      .then(() => {
        renderInventory();
        updateUI();
      })
      .catch((e) => console.error('Failed to persist inventory:', e));

    // Highlight the new item
    setTimeout(() => {
      const el = inventoryGrid.children[0]; // First item is the new one
      if (el) {
        el.style.borderColor = "#2ecc71";
        el.style.boxShadow = "0 0 15px #2ecc71";
        setTimeout(() => {
          el.style.borderColor = "rgba(255,255,255,0.05)";
          el.style.boxShadow = "none";
        }, 1000);
      }
    }, 100);

    // Reset button after 2.5 seconds
    setTimeout(() => {
      rollBtn.className = "roll-btn";
      updateUI();
      setUIBlocked(false);
    }, 2500);
  } else {
    const lostValue = selectedItems.reduce((sum, it) => sum + Number(it.price || 0), 0);

    // Remove all selected items
    selectedInventoryIndices.sort((a, b) => b - a); // Sort descending to remove from end
    selectedInventoryIndices.forEach(index => {
      inventory.splice(index, 1);
    });

    // Clear selection
    selectedInventoryIndices = [];
    selectedTargetIndex = -1;

    renderInventory();
    updateUI();

    openConsolationCase(lostValue)
      .then((wonSkin) => {
        if (wonSkin) {
          inventory.unshift({ ...wonSkin, id: Date.now() });
        }
        renderInventory();
        updateUI();
        return persistCurrentInventory();
      })
      .then(() => fetchRealBalance())
      .then(() => {
        renderInventory();
        updateUI();
      })
      .catch((e) => console.error('Failed to persist inventory:', e));

    // Reset button after 2.5 seconds
    setTimeout(() => {
      rollBtn.className = "roll-btn";
      updateUI();
      setUIBlocked(false);
    }, 2500);
  }
}

// Start
init();