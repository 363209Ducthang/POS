// =============================================
// TẠP HÓA POS V5.4 – APP.JS (HOÀN CHỈNH)
// CHIA NHỎ THÀNH NHIỀU PHẦN ĐỂ DỄ COPY
// =============================================

// ----- PHẦN 1: IMPORT VÀ KHỞI TẠO -----
import {
  auth, onAuthState, logoutUser,
  getProducts, getOrders, commitSale, receiveStock,
  addProduct, updateProduct, deleteProductFirebase,
  getCustomers, addCustomer, updateCustomer, deleteCustomer,
  listenProducts, listenOrders, listenCustomers,
  addSupplier, updateSupplier, deleteSupplier, getSuppliers,
  addExpense, deleteExpense, getExpenses,
  cancelOrder, getSettings, saveSettings
} from "../firebase-config.js";

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(n) || 0);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bankOptions = [
  ["970422", "MB Bank"], ["970436", "Vietcombank"], ["970418", "BIDV"], ["970405", "Agribank"],
  ["970415", "VietinBank"], ["970407", "Techcombank"], ["970416", "ACB"], ["970432", "VPBank"],
  ["970423", "TPBank"], ["970403", "Sacombank"], ["970437", "HDBank"], ["970443", "SHB"],
  ["970440", "SeABank"], ["970448", "OCB"], ["970426", "MSB"], ["970431", "Eximbank"],
  ["970409", "Bac A Bank"], ["970428", "Nam A Bank"], ["970434", "Viet Capital Bank"], ["970441", "VIB"]
];
const machineId = localStorage.getItem("thpos_machine_id") || (() => { const x = "POS-" + Math.random().toString(36).slice(2, 8).toUpperCase(); localStorage.setItem("thpos_machine_id", x); return x; })();

const state = {
  products: [],
  orders: [],
  customers: [],
  suppliers: [],
  expenses: [],
  page: "dashboard",
  payment: "cash",
  cart: [],
  category: "all",
  machineId,
  productFilter: "",
  receiveProductId: "",
  unitConfig: { unit1: true, unit2: true, unit3: true },
  dashboardPeriod: "day",
  storeSettings: {},
  productByBarcode: new Map(),
  unitCache: new WeakMap(),
  qrKey: ""
};

function getDefaultUnitConfig() {
  return { unit1: true, unit2: true, unit3: true };
}

function getVisibleUnitSlots() {
  const cfg = state.unitConfig || getDefaultUnitConfig();
  return [
    { key: "unit1", enabled: cfg.unit1 !== false },
    { key: "unit2", enabled: cfg.unit2 !== false },
    { key: "unit3", enabled: cfg.unit3 !== false }
  ];
}

// ----- PHẦN 2: TOAST, PAGE NAVIGATION, ERROR HANDLING -----
function toast(t, ok = true) {
  const e = $("toast");
  if (!e) return;
  e.textContent = t;
  e.style.opacity = 1;
  e.style.transform = "translateY(0)";
  e.style.background = ok ? "#17213a" : "#b42318";
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { e.style.opacity = 0; e.style.transform = "translateY(8px)"; }, 2600);
}

function setPage(page) {
  state.page = page;
  document.querySelectorAll(".page").forEach(e => e.classList.toggle("hidden", e.id !== "page-" + page));
  document.querySelectorAll(".nav[data-page]").forEach(e => e.classList.toggle("active", e.dataset.page === page));

  const titles = {
    dashboard: ["Tổng quan", "Doanh thu, lợi nhuận và hoạt động cửa hàng."],
    sale: ["Thu ngân", "Quét mã, lập đơn và thanh toán."],
    products: ["Hàng hóa", "Quản lý sản phẩm và barcode."],
    inventory: ["Kho hàng", "Nhập hàng và theo dõi tồn kho."],
    customers: ["Khách hàng", "Lịch sử và thông tin khách hàng."],
    orders: ["Đơn hàng", "Theo dõi các giao dịch."],
    suppliers: ["Nhà cung cấp", "Quản lý nguồn hàng."],
    expenses: ["Chi phí", "Theo dõi chi phí cửa hàng."],
    reports: ["Báo cáo", "Doanh thu, giá vốn và lợi nhuận."],
    import: ["Nhập / Xuất Excel", "Nhập xuất dữ liệu hàng hóa."],
    notifications: ["Thông báo", "Cảnh báo tồn kho."],
    settings: ["Cài đặt", "Cấu hình cửa hàng."]
  };
  if (titles[page]) { $("pageTitle").textContent = titles[page][0]; $("pageSub").textContent = titles[page][1]; }

  if (page === "sale") {
    renderSale();
    setTimeout(() => { renderSale(); $("barcodeInput")?.focus(); }, 80);
  }
  if (page === "products") renderProducts();
  if (page === "inventory") renderInventory();
  if (page === "orders") renderOrdersV53();
  if (page === "dashboard") renderDashboardV53();
  if (page === "reports") renderReportsV53();
  if (page === "notifications") renderNotificationsV53();
  if (page === "settings") renderSettingsV53();
}
window.page = setPage;

window.addEventListener("error", e => { console.error(e.error || e.message); try { toast("Lỗi JavaScript: " + (e.message || "không xác định"), false); } catch (_) { } });
window.addEventListener("unhandledrejection", e => { console.error(e.reason); try { toast("Lỗi: " + (e.reason?.message || e.reason || "không xác định"), false); } catch (_) { } });

// ----- PHẦN 3: HELPER (normalizeBarcode, findProduct, unitsOf, preferredUnit) -----
function normalizeBarcode(v) { return String(v || "").trim().replace(/\s+/g, ""); }
function debounce(fn, delay = 120) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}
function rebuildProductIndex(products) {
  state.productByBarcode = new Map();
  products.forEach(product => {
    const barcode = normalizeBarcode(product.barcode);
    if (barcode) state.productByBarcode.set(barcode, product);
  });
}
function productsCacheKey() {
  return `thpos_products_cache_${auth.currentUser?.uid || "guest"}`;
}
function setProducts(products) {
  state.products = Array.isArray(products) ? products : [];
  rebuildProductIndex(state.products);
  state.unitCache = new WeakMap();
  try { localStorage.setItem(productsCacheKey(), JSON.stringify(state.products)); } catch (_) { }
}
function loadCachedProducts() {
  try {
    const cached = JSON.parse(localStorage.getItem(productsCacheKey()) || "[]");
    if (Array.isArray(cached) && cached.length) { setProducts(cached); return true; }
  } catch (_) { }
  return false;
}
function findProduct(barcode) { return state.productByBarcode.get(normalizeBarcode(barcode)); }
function createEan13() {
  let code;
  do {
    const base = "893" + String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 100)).padStart(2, "0");
    const digits = base.slice(0, 12);
    const sum = digits.split("").reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    code = digits + String((10 - (sum % 10)) % 10);
  } while (findProduct(code));
  return code;
}
function unitsOf(p) {
  if (state.unitCache.has(p)) return state.unitCache.get(p);
  const arr = [];
  for (const slot of getVisibleUnitSlots()) {
    if (!slot.enabled) continue;
    const i = Number(slot.key.replace("unit", ""));
    const key = slot.key;
    const name = p[key], factor = Number(p[key + "Factor"]);
    if (name && factor > 0) arr.push({ name, factor, cost: Number(p[key + "Cost"] || 0), price: Number(p[key + "Price"] || 0) });
  }
  if (!arr.length) arr.push({ name: p.unit || "Cái", factor: 1, cost: Number(p.cost || 0), price: Number(p.price || 0) });
  state.unitCache.set(p, arr);
  return arr;
}
function preferredUnit(p) { return unitsOf(p).find(u => u.name === p.preferredUnit) || unitsOf(p)[0]; }

// ----- PHẦN 4: CART LOGIC -----
function addCart(p, unitName = null, qty = 1) {
  const u = unitsOf(p).find(x => x.name === unitName) || preferredUnit(p);
  const base = Number(qty) * u.factor;
  const existing = state.cart.find(x => x.productId === p.id && x.unit === u.name);
  const already = state.cart.filter(x => x.productId === p.id).reduce((a, x) => a + x.baseQty, 0);
  if ((Number(p.stockBase) || 0) < already + base) {
    toast(`Không đủ tồn kho ${p.name}. Còn ${p.stockBase || 0} đơn vị cơ sở.`, false);
    return false;
  }
  if (existing) { existing.qty += Number(qty); existing.baseQty += base; }
  else state.cart.push({ productId: p.id, name: p.name, barcode: p.barcode || "", unit: u.name, qty: Number(qty), factor: u.factor, baseQty: base, price: u.price, cost: u.cost });
  renderCart();
  return true;
}

function removeCart(i) { state.cart.splice(i, 1); renderCart(); }

function changeQty(i, d) {
  const x = state.cart[i];
  if (!x) return;
  const p = state.products.find(p => p.id === x.productId);
  const n = x.qty + d;
  if (n <= 0) { removeCart(i); return; }
  const other = state.cart.filter((y, j) => j !== i && y.productId === x.productId).reduce((a, y) => a + y.baseQty, 0);
  if (other + n * x.factor > (Number(p?.stockBase) || 0)) { toast("Không đủ tồn kho.", false); return; }
  x.qty = n;
  x.baseQty = n * x.factor;
  renderCart();
}

function changeUnit(i, name) {
  const x = state.cart[i];
  const p = state.products.find(p => p.id === x.productId);
  const u = unitsOf(p).find(u => u.name === name);
  if (!u) return;
  const other = state.cart.filter((y, j) => j !== i && y.productId === x.productId).reduce((a, y) => a + y.baseQty, 0);
  if (other + x.qty * u.factor > (Number(p.stockBase) || 0)) { toast("Không đủ tồn kho cho đơn vị này.", false); return; }
  x.unit = u.name;
  x.factor = u.factor;
  x.baseQty = x.qty * u.factor;
  x.price = u.price;
  x.cost = u.cost;
  renderCart();
}

function renderCart() {
  const box = $("cart");
  if (!box) return;
  if (!state.cart.length) { box.innerHTML = '<div style="padding:50px;text-align:center;color:#98a2b3">Quét mã sản phẩm để bắt đầu</div>'; } else {
    box.innerHTML = state.cart.map((x, i) => `
      <div class="cart-item">
        <div class="cart-main">
          <div><div class="cart-name">${esc(x.name)}</div><div class="cart-sub">${esc(x.barcode)} · ${money(x.price)}/${esc(x.unit)}</div></div>
          <b>${money(x.qty * x.price)}</b>
        </div>
        <div class="cart-controls">
          <button class="qty-btn" data-act="dec" data-i="${i}">−</button>
          <b>${x.qty}</b>
          <button class="qty-btn" data-act="inc" data-i="${i}">＋</button>
          <select class="unit-select" data-act="unit" data-i="${i}">${unitsOf(state.products.find(p => p.id === x.productId) || {}).map(u => `<option ${u.name === x.unit ? 'selected' : ''}>${esc(u.name)}</option>`).join("")}</select>
          <button class="danger" data-act="remove" data-i="${i}">X</button>
        </div>
      </div>
    `).join("");
  }
  const sub = state.cart.reduce((a, x) => a + x.qty * x.price, 0);
  const discount = Math.max(0, Number($("discount")?.value) || 0);
  const total = Math.max(0, sub - discount);
  $("subtotal").textContent = money(sub);
  $("total").textContent = money(total);
  updateCustomerScreen(total);
  renderQR(total);
}

// ----- PHẦN 5: CART EVENTS -----
$("cart")?.addEventListener("click", e => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const i = +b.dataset.i;
  if (b.dataset.act === "inc") changeQty(i, 1);
  if (b.dataset.act === "dec") changeQty(i, -1);
  if (b.dataset.act === "remove") removeCart(i);
});

$("cart")?.addEventListener("change", e => { 
  if (e.target.dataset.act === "unit") changeUnit(+e.target.dataset.i, e.target.value); 
});

const discountInput = $("discount");
if (discountInput) {
  discountInput.addEventListener("input", renderCart);
  discountInput.addEventListener("change", renderCart);
}

// ----- PHẦN 6: SCANNER LOGIC -----
function scanSale(raw) {
  const code = normalizeBarcode(raw);
  if (!code) return;
  const p = findProduct(code);
  if (!p) { toast(`Không tìm thấy barcode: ${code}`, false); openProductModal({ barcode: code }); }
  else { addCart(p); toast(`Đã thêm: ${p.name}`); }
  const e = $("barcodeInput");
  if (e) { e.value = ""; e.focus(); }
}

function scanReceive(raw) {
  const code = normalizeBarcode(raw);
  if (!code) return;
  const p = findProduct(code);
  if (!p) { toast(`Chưa có sản phẩm ${code}`, false); openProductModal({ barcode: code, afterCreate: "receive" }); }
  else { selectReceiveProduct(p.id); toast(`Đã chọn: ${p.name}`); }
  const e = $("receiveBarcodeInput");
  if (e) { e.value = ""; e.focus(); }
}

function scannerInput(el, fn) {
  let timer;
  el?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); fn(el.value); } });
  el?.addEventListener("input", () => { clearTimeout(timer); if (el.value.length >= 6) timer = setTimeout(() => fn(el.value), 140); });
}
scannerInput($("barcodeInput"), scanSale);
scannerInput($("receiveBarcodeInput"), scanReceive);
let hidBuffer = "";
let hidTimer = null;
let scannerTarget = "sale";
function handleHidScan(code) {
  const value = normalizeBarcode(code);
  if (!value) return;
  if (scannerTarget === "receive") scanReceive(value); else scanSale(value);
}
document.addEventListener("keydown", e => {
  const target = e.target;
  if (target?.id === "barcodeInput" || target?.id === "receiveBarcodeInput") return;
  if (target?.matches("input, textarea, select") && target.id !== "barcodeInput" && target.id !== "receiveBarcodeInput") return;
  if (e.key === "Enter") {
    if (hidBuffer.length >= 3) handleHidScan(hidBuffer);
    hidBuffer = "";
    clearTimeout(hidTimer);
    return;
  }
  if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
  hidBuffer += e.key;
  clearTimeout(hidTimer);
  hidTimer = setTimeout(() => { hidBuffer = ""; }, 180);
});
$("barcodeInput")?.addEventListener("focus", () => { scannerTarget = "sale"; });
$("receiveBarcodeInput")?.addEventListener("focus", () => { scannerTarget = "receive"; });
let cameraStream = null;
let cameraTimer = null;
let cameraDone = false;
let cameraMode = "native";
async function openCameraScanner(onCode) {
  const box = $("cameraScanner"), video = $("cameraVideo"), viewport = $("cameraViewport"), status = $("cameraStatus");
  if (!box || !video) return;
  closeCameraScanner();
  box.classList.remove("hidden");
  cameraDone = false;
  if (!("BarcodeDetector" in window) && window.Quagga) {
    cameraMode = "quagga";
    if (status) status.textContent = "Đưa mã vạch vào khung quét.";
    if (viewport) viewport.innerHTML = "";
    window.Quagga.init({
      inputStream: { type: "LiveStream", target: viewport || box, constraints: { facingMode: "environment" } },
      decoder: { readers: ["ean_reader", "ean_8_reader", "upc_reader", "code_128_reader"] },
      locate: true
    }, error => {
      if (error) { closeCameraScanner(); toast("Không mở được camera. Hãy cấp quyền camera cho trình duyệt.", false); return; }
      window.Quagga.start();
    });
    window.Quagga.onDetected(result => {
      const code = result?.codeResult?.code;
      if (code && !cameraDone) { cameraDone = true; onCode(normalizeBarcode(code)); closeCameraScanner(); }
    });
    return;
  }
  if (!("BarcodeDetector" in window)) { box.classList.add("hidden"); toast("Chưa tải được bộ quét camera. Hãy thử lại khi có Internet.", false); return; }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = cameraStream;
    cameraMode = "native";
    const detector = new BarcodeDetector();
    const scanFrame = async () => {
      if (cameraDone || box.classList.contains("hidden")) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length && codes[0].rawValue) {
          cameraDone = true;
          onCode(normalizeBarcode(codes[0].rawValue));
          closeCameraScanner();
          return;
        }
        if (status) status.textContent = "Đưa mã vạch vào khung quét.";
      } catch (_) { }
      cameraTimer = requestAnimationFrame(scanFrame);
    };
    video.onloadedmetadata = () => { video.play(); scanFrame(); };
  } catch (e) {
    toast(e?.name === "NotAllowedError" ? "Hãy cho phép trình duyệt dùng camera." : "Không mở được camera.", false);
  }
}
function closeCameraScanner() {
  cameraDone = true;
  if (cameraTimer) cancelAnimationFrame(cameraTimer);
  cameraTimer = null;
  if (cameraMode === "quagga" && window.Quagga) {
    try { window.Quagga.stop(); window.Quagga.offDetected(); } catch (_) { }
  }
  if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
  cameraStream = null;
  const video = $("cameraVideo");
  if (video) video.srcObject = null;
  $("cameraScanner")?.classList.add("hidden");
}
$("scanSaleBtn")?.addEventListener("click", () => openCameraScanner(scanSale));
$("scanReceiveBtn")?.addEventListener("click", () => {
  scannerTarget = "receive";
  openCameraScanner(scanReceive);
});
$("closeCameraScanner")?.addEventListener("click", closeCameraScanner);

document.addEventListener("keydown", e => {
  if (e.key === "F2") { e.preventDefault(); setPage("sale"); $("barcodeInput")?.focus(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPage("sale"); $("barcodeInput")?.focus(); }
});

// ----- PHẦN 7: SALE PAGE RENDER -----
function renderSale() {
  const grid = $("productGrid");
  if (!grid) return;
  if (!Array.isArray(state.products) || !state.products.length) {
    grid.innerHTML = '<div class="product-loading product-error">Chưa tải được sản phẩm.<button type="button" class="soft" data-retry-products>Tải lại danh sách</button></div>';
    return;
  }
  const q = ($("productSearch")?.value || "").toLowerCase();
  const cat = state.category;
    const ps = state.products.filter(p => (cat === "all" || p.category === cat) && (!q || String(p.name || "").toLowerCase().includes(q) || normalizeBarcode(p.barcode).includes(q)));
  grid.innerHTML = ps.map(p => {
    const u = preferredUnit(p);
    return `<button class="product-card" data-pid="${p.id}" style="text-align:left">
      <div class="name">${esc(p.name)}</div>
      <div class="price">${money(u.price)}</div>
      <div class="unit-price">${esc(u.name)} · ${esc(p.barcode || "Chưa có mã")}</div>
      <div class="stock">Tồn: ${Number(p.stockBase) || 0}</div>
    </button>`;
  }).join("") || '<div class="product-loading">Không tìm thấy sản phẩm phù hợp.</div>';
  const cats = [...new Set(state.products.map(p => p.category).filter(Boolean))];
  $("categoryBar").innerHTML = `<button class="category-btn ${state.category === 'all' ? 'active' : ''}" data-cat="all">Tất cả</button>` + cats.map(c => `<button class="category-btn ${state.category === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
}
$("productGrid")?.addEventListener("click", event => {
  if (!event.target.closest("[data-retry-products]")) return;
  renderSale();
  loadProductsNow();
});
$("productGrid")?.addEventListener("click", e => { const b = e.target.closest("[data-pid]"); if (b) { const p = state.products.find(x => x.id === b.dataset.pid); if (p) addCart(p); } });
$("categoryBar")?.addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (b) { state.category = b.dataset.cat; renderSale(); } });
$("productSearch")?.addEventListener("input", renderSale);

// ----- PHẦN 8: RECEIVE / INVENTORY LOGIC -----
function selectReceiveProduct(id) {
  state.receiveProductId = id;
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  const s = $("receiveProduct");
  if (s) { s.value = id; renderReceiveUnits(); }
  if ($("receiveCost")) $("receiveCost").value = Number(preferredUnit(p).cost) || 0;
}

function renderReceiveUnits() {
  const p = state.products.find(x => x.id === state.receiveProductId);
  if (!p) return;
  $("receiveUnit").innerHTML = unitsOf(p).map(u => `<option value="${esc(u.name)}">${esc(u.name)} (×${u.factor})</option>`).join("");
}

function stockDisplay(p) {
  const base = Math.max(0, Number(p?.stockBase) || 0);
  const us = unitsOf(p || {}).slice().sort((a, b) => b.factor - a.factor);
  if (!us.length) return `${base} ${p?.unit || "cái"}`;
  let remain = base, parts = [];
  for (const u of us) {
    if (u.factor <= 0) continue;
    const n = Math.floor(remain / u.factor);
    if (n > 0) { parts.push(`${n} ${u.name}`); remain -= n * u.factor; }
  }
  if (remain > 0) { const baseUnit = unitsOf(p || {}).slice().sort((a, b) => a.factor - b.factor)[0]; parts.push(`${remain} ${baseUnit?.name || "cơ sở"}`); }
  return parts.join(" + ") || `0 ${us[us.length - 1].name}`;
}

function lowState(p) {
  const base = Math.max(0, Number(p?.stockBase) || 0);
  const us = unitsOf(p || {});
  const largest = us.slice().sort((a, b) => b.factor - a.factor)[0];
  const thresholdUnits = Number(p?.lowStock || 0);
  const thresholdBase = thresholdUnits * (largest?.factor || 1);
  return { low: base <= thresholdBase, stockBase: base, display: stockDisplay(p), threshold: largest ? `${thresholdUnits} ${largest.name}` : `${thresholdUnits}` };
}

function renderInventory() {
  const q = ($("inventorySearch")?.value || "").toLowerCase();
  const ps = state.products.filter(p => !q || String(p.name || "").toLowerCase().includes(q) || normalizeBarcode(p.barcode).includes(q));
    $("inventoryTable").innerHTML = ps.map(p => {
    const u = preferredUnit(p), ls = lowState(p), low = ls.low;
    return `<tr>
      <td>${esc(p.barcode || "—")}</td>
      <td><b>${esc(p.name)}</b></td>
      <td>${money(u.price)}</td>
      <td>${esc(u.name)}</td>
      <td>${esc(p.preferredUnit || u.name)}</td>
      <td>${esc(ls.display)}</td>
      <td>${u.factor} cơ sở/${esc(u.name)}</td>
      <td class="${low ? 'warning' : 'ok'}">${low ? 'Cần nhập' : 'Ổn'}</td>
      <td><button class="pencil" data-edit="${p.id}">✎</button></td>
    </tr>`;
  }).join("");
  $("invProductCount").textContent = state.products.length;
  $("invStockCount").textContent = state.products.reduce((a, p) => a + (Number(p.stockBase) || 0), 0);
  $("invStockValue").textContent = money(state.products.reduce((a, p) => a + (Number(p.stockBase || 0) * (Number(preferredUnit(p).cost || 0) / (Number(preferredUnit(p).factor) || 1))), 0));
  $("invWarningCount").textContent = state.products.filter(p => lowState(p).low).length;
  $("receiveProduct").innerHTML = '<option value="">Chọn sản phẩm</option>' + state.products.map(p => `<option value="${p.id}">${esc(p.name)} · ${esc(p.barcode || '')}</option>`).join("");
  if (state.receiveProductId) { $("receiveProduct").value = state.receiveProductId; renderReceiveUnits(); }
}
$("inventorySearch")?.addEventListener("input", renderInventory);
$("receiveProduct")?.addEventListener("change", e => selectReceiveProduct(e.target.value));
$("receiveUnit")?.addEventListener("change", () => {
  const p = state.products.find(x => x.id === state.receiveProductId);
  const u = unitsOf(p || {}).find(x => x.name === $("receiveUnit").value);
  if (u) $("receiveCost").value = u.cost || 0;
});
$("receiveBtn")?.addEventListener("click", async () => {
  const p = state.products.find(x => x.id === $("receiveProduct").value);
  if (!p) { toast("Hãy chọn sản phẩm.", false); return; }
  const u = unitsOf(p).find(x => x.name === $("receiveUnit").value) || preferredUnit(p);
  const qty = Number($("receiveQty").value) || 0;
  const cost = Number($("receiveCost").value) || u.cost;
  if (qty <= 0) { toast("Số lượng phải lớn hơn 0.", false); return; }
  const r = await receiveStock(p.id, qty * u.factor, cost, u.name);
  if (!r.success) { toast(r.error, false); return; }
  toast(`Đã nhập ${qty} ${u.name} ${p.name}`);
  $("receiveQty").value = 1;
});

// ----- PHẦN 9: PRODUCTS PAGE RENDER & DELETE -----
function renderProducts() {
  const q = (state.productFilter || "").toLowerCase();
  const ps = state.products.filter(p => !q || String(p.name || "").toLowerCase().includes(q) || normalizeBarcode(p.barcode).includes(q));
    $("productsTable").innerHTML = ps.map(p => {
    const u = preferredUnit(p);
    return `<tr>
      <td>${esc(p.barcode || "—")}</td>
      <td><b>${esc(p.name)}</b></td>
      <td>${esc(u.name)}</td>
      <td>${money(u.price)}</td>
      <td>${money(u.cost)}</td>
      <td>${Number(p.stockBase) || 0}</td>
      <td>${p.active === false ? '<span class="warning">Ngừng bán</span>' : '<span class="ok">Đang bán</span>'}</td>
      <td><button class="pencil" data-edit="${p.id}">✎</button> <button class="delete-btn" data-delete="${p.id}">×</button></td>
    </tr>`;
  }).join("");
}
$("productsSearch")?.addEventListener("input", e => { state.productFilter = e.target.value; renderProducts(); });
$("productsTable")?.addEventListener("click", e => {
  const ed = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-delete]");
  if (ed) openProductModal(state.products.find(p => p.id === ed.dataset.edit));
  if (del) {
    e.preventDefault();
    e.stopPropagation();
    deleteProduct(del.dataset.delete);
  }
});
$("addProductBtn")?.addEventListener("click", () => openProductModal());

async function deleteProduct(id) {
  if (!id) { toast("Không xác định được sản phẩm cần xóa.", false); return; }
  if (!confirm("Xóa sản phẩm này? Đơn hàng cũ vẫn giữ dữ liệu đã bán.")) return;
  const r = await deleteProductFirebase(id);
  if (r.success) {
    state.products = state.products.filter(product => product.id !== id);
    state.cart = state.cart.filter(item => item.productId !== id);
    rebuildProductIndex(state.products);
    try { localStorage.setItem(productsCacheKey(), JSON.stringify(state.products)); } catch (_) { }
    renderProducts();
    renderCart();
    toast("Đã xóa sản phẩm");
  } else toast(r.error || "Không thể xóa sản phẩm.", false);
}

const unitPresets = [
  { label: "Thùng - Lốc - Lon", units: ["thùng", "lốc", "lon"], factors: [24, 6, 1] },
  { label: "Thùng - Lốc - Chai", units: ["thùng", "lốc", "chai"], factors: [24, 6, 1] },
  { label: "Thùng - Dây - Hộp", units: ["thùng", "dây", "gói"], factors: [24, 12, 1] },
  { label: "Thùng - Gói", units: ["thùng", "gói"], factors: [30, 1] },
  { label: "Thùng - Chai", units: ["thùng", "chai"], factors: [24, 1] },
  { label: "Thùng - Cái", units: ["thùng", "cái"], factors: [24, 1] },
  { label: "Bịch - Gói", units: ["bịch", "gói"], factors: [10, 1] },
  { label: "Hộp - Gói", units: ["hộp", "gói"], factors: [20, 1] },
  { label: "Hộp - Cái", units: ["hộp", "cái"], factors: [20, 1] },
  { label: "Thùng - Hộp", units: ["thùng", "hộp"], factors: [12, 1] },
  { label: "Lốc - Lon", units: ["lốc", "lon"], factors: [6, 1] },
  { label: "Tùy chỉnh", units: ["đơn vị 1", "đơn vị 2"], factors: [1, 1] }
];

// ----- PHẦN 10: PRODUCT MODAL (Thêm/Sửa) -----
function openProductModal(product = {}) {
  const isEdit = !!product.id;
  $("modalTitle").textContent = isEdit ? "Sửa sản phẩm" : "Thêm sản phẩm";
  const u = unitsOf(product);
  const visibleSlots = getVisibleUnitSlots();
  const slotMarkup = [1, 2, 3].map(i => {
    const enabled = visibleSlots[i - 1]?.enabled ?? true;
    if (!enabled) return "";
    return `
      <label>Đơn vị ${i}<input id="mU${i}" value="${esc(u[i - 1]?.name || (i === 1 ? product.unit || "Cái" : ""))}"></label>
      <label>Hệ số<input id="mF${i}" type="number" min="1" value="${u[i - 1]?.factor || 1}"></label>
      <label>Giá vốn<input id="mC${i}" type="number" min="0" value="${u[i - 1]?.cost || 0}"></label>
      <label>Giá bán<input id="mP${i}" type="number" min="0" value="${u[i - 1]?.price || 0}"></label>
    `;
  }).join("");
  $("modalBody").innerHTML = `
    <div class="unit-quick">
      <div class="unit-quick-head">
        <strong>Quy cách đơn vị</strong>
        <span>Chọn preset hoặc nhập theo cách của bạn</span>
      </div>
      <div class="unit-quick-row">
        <label>Preset quy đổi<select id="mPreset"><option value="">-- Chọn preset --</option>${unitPresets.map(p => `<option value="${p.label}">${p.label}</option>`).join("")}</select></label>
        <label>Đơn vị ưu tiên<select id="mPref"><option value="unit1">Đơn vị 1</option><option value="unit2">Đơn vị 2</option><option value="unit3">Đơn vị 3</option></select></label>
      </div>
    </div>
    <div class="form-grid">
      <label class="full">Barcode<div class="barcode-entry"><input id="mBarcode" value="${esc(product.barcode || "")}" autofocus><button type="button" class="soft scan-button" id="scanProductBtn">▣ Quét mã</button><button type="button" class="soft scan-button" id="generateBarcodeBtn">＋ Tạo mã</button></div><div id="barcodePreview" class="barcode-preview"></div></label>
      <label class="full">Tên sản phẩm<input id="mName" value="${esc(product.name || "")}" placeholder="Ví dụ: Coca-Cola 330ml"></label>
      <label>Danh mục
        <input id="mCategory" list="productCategoryList" value="${esc(product.category || "")}" placeholder="Nhập mới hoặc chọn danh mục">
        <datalist id="productCategoryList"></datalist>
      </label>
      <label>Cảnh báo tồn<input id="mLow" type="number" min="0" value="${Number(product.lowStock || 0)}"></label>
      ${slotMarkup}
      <label>Tồn cơ sở<input id="mStock" type="number" min="0" value="${Number(product.stockBase || 0)}" ${isEdit ? 'disabled' : ''}></label>
    </div>
    <div class="form-actions"><button class="soft" id="cancelModal">Hủy</button><button class="primary" id="saveProductModal">Lưu sản phẩm</button></div>
  `;
  const populateCategorySuggestions = async () => {
    const list = $("productCategoryList");
    if (!list) return;
    const cfg = await getSettings();
    const options = [...new Set([
      ...(cfg.categories || []),
      ...state.products.map(p => p.category).filter(Boolean)
    ])].filter(Boolean).sort((a, b) => a.localeCompare(b));
    list.innerHTML = options.map(c => `<option value="${esc(c)}"></option>`).join("");
  };
  populateCategorySuggestions();

  if (product.preferredUnit) {
    const idx = u.findIndex(x => x.name === product.preferredUnit);
    if (idx >= 0) $("mPref").value = "unit" + (idx + 1);
  }
  $("modal").classList.remove("hidden");
  $("mBarcode").focus();

  $("mPreset").onchange = () => {
    const selected = unitPresets.find(p => p.label === $("mPreset").value);
    if (!selected) return;
    const values = [selected.units[0] || "", selected.units[1] || "", selected.units[2] || ""];
    const factors = [Number(selected.factors[0]) || 1, Number(selected.factors[1]) || 1, Number(selected.factors[2]) || 1];
    if ($("mU1")) { $("mU1").value = values[0]; $("mF1").value = factors[0]; }
    if ($("mU2")) { $("mU2").value = values[1]; $("mF2").value = factors[1]; }
    if ($("mU3")) { $("mU3").value = values[2]; $("mF3").value = factors[2]; }
  };

  $("scanProductBtn").onclick = () => openCameraScanner(code => { $("mBarcode").value = code; $("mBarcode").dispatchEvent(new Event("input")); $("mName").focus(); });
  const drawBarcode = () => {
    const preview = $("barcodePreview");
    if (!preview || !window.JsBarcode) return;
    preview.innerHTML = "<svg id='generatedBarcode'></svg>";
    const value = $("mBarcode").value.trim();
    if (!value) return;
    try { window.JsBarcode("#generatedBarcode", value, { format: "auto", displayValue: true, height: 48, margin: 4 }); } catch (_) { preview.textContent = "Barcode chưa hợp lệ."; }
  };
  $("mBarcode").addEventListener("input", drawBarcode);
  $("generateBarcodeBtn").onclick = () => { $("mBarcode").value = createEan13(); drawBarcode(); };
  drawBarcode();

  $("saveProductModal").onclick = async () => {
    const barcode = normalizeBarcode($("mBarcode").value);
    const name = $("mName").value.trim();
    if (!barcode || !name) { toast("Barcode và tên sản phẩm là bắt buộc.", false); return; }
    const duplicate = state.products.find(p => normalizeBarcode(p.barcode) === barcode && p.id !== product.id);
    if (duplicate) { toast("Barcode đã tồn tại.", false); return; }
    const d = { barcode, name, category: $("mCategory").value.trim(), lowStock: Number($("mLow").value) || 0, stockBase: isEdit ? Number(product.stockBase) || 0 : Number($("mStock").value) || 0, active: true };
    for (let i = 1; i <= 3; i++) {
      const visible = getVisibleUnitSlots()[i - 1]?.enabled ?? true;
      if (!visible) {
        d["unit" + i] = "";
        d["unit" + i + "Factor"] = 1;
        d["unit" + i + "Cost"] = 0;
        d["unit" + i + "Price"] = 0;
        continue;
      }
      d["unit" + i] = $("mU" + i).value.trim();
      d["unit" + i + "Factor"] = Number($("mF" + i).value) || 1;
      d["unit" + i + "Cost"] = Number($("mC" + i).value) || 0;
      d["unit" + i + "Price"] = Number($("mP" + i).value) || 0;
    }
    d.preferredUnit = d[$("mPref").value];
    const r = isEdit ? await updateProduct(product.id, d) : await addProduct(d);
    if (r.success) { $("modal").classList.add("hidden"); toast(isEdit ? "Đã cập nhật sản phẩm" : "Đã thêm sản phẩm"); if (product.afterCreate === "receive") setTimeout(() => { setPage("inventory"); selectReceiveProduct(r.id); }, 300); } else toast(r.error, false);
  };
  $("cancelModal").onclick = () => $("modal").classList.add("hidden");
}
$("closeModal")?.addEventListener("click", () => $("modal").classList.add("hidden"));

// ----- PHẦN 11: CHECKOUT, QR, PRINT RECEIPT -----
async function checkout() {
  if (!state.cart.length) { toast("Chưa có sản phẩm trong hóa đơn.", false); return; }
  const sub = state.cart.reduce((a, x) => a + x.qty * x.price, 0);
  const discount = Math.min(sub, Math.max(0, Number($("discount").value) || 0));
  const total = sub - discount;
  const btn = $("checkoutBtn");
  btn.disabled = true;
  btn.textContent = "ĐANG XỬ LÝ...";
  const customer = $("customerSelect")?.value || "";
  
  // Generate QR data for transfer payment
  let qrData = "";
  if (state.payment === "transfer") {
    const store = state.storeSettings || {};
    const bankName = localStorage.getItem("thpos_bank_name") || store.bankName || "";
    const bank = { id: "legacy", name: bankName, code: localStorage.getItem("thpos_bank_code") || store.bankCode || bankBinFromName(bankName), number: localStorage.getItem("thpos_bank_number") || store.bankNumber || "", owner: localStorage.getItem("thpos_bank_owner") || store.bankOwner || "" };
    if (bank.code && bank.number) {
      qrData = vietQrUrl(bank, total);
    }
  }
  
  const order = {
    machineId, stateMachine: machineId,
    paymentMethod: state.payment,
    status: state.payment === "transfer" ? "pending_transfer" : "paid",
    subtotal: sub, discount, total,
    customerId: customer || null,
    operatorId: auth.currentUser?.uid || null,
    operatorName: auth.currentUser?.displayName || auth.currentUser?.email || "",
    qrData: qrData
  };
  const r = await commitSale(order, state.cart.map(x => ({ ...x })));
  btn.disabled = false;
  btn.textContent = "THANH TOÁN";
  if (!r.success) { toast(r.error, false); return; }
  toast(`Thanh toán thành công · ${money(total)}`);
  printReceipt({ ...order, id: r.id, items: state.cart.map(x => ({ ...x })) });
  state.cart = [];
  $("discount").value = 0;
  renderCart();
}
$("checkoutBtn")?.addEventListener("click", checkout);

// Attach payment method button listeners with better error handling
function attachPaymentListeners() {
  const payButtons = document.querySelectorAll(".pay");
  if (payButtons.length === 0) return; // Elements might not be ready yet
  payButtons.forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".pay").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    const method = b.dataset.method;
    if (method) {
      state.payment = method;
      renderCart();
    }
  }));
}

// Ensure payment listeners are attached
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachPaymentListeners);
} else {
  attachPaymentListeners();
}

function renderQR(total) {
  const box = $("bankBox");
  if (!box) return;
  box.classList.toggle("hidden", state.payment !== "transfer");
  if (state.payment !== "transfer") return;
  const accounts = state.storeSettings?.bankAccounts || [];
  const selectedId = $("bankSelect")?.value || localStorage.getItem("thpos_active_bank") || accounts[0]?.id || "";
  const selected = accounts.find(account => account.id === selectedId) || accounts[0];
  const legacyName = localStorage.getItem("thpos_bank_name") || state.storeSettings?.bankName || "";
  const bank = selected || { id: "legacy", name: legacyName, code: localStorage.getItem("thpos_bank_code") || state.storeSettings?.bankCode || bankBinFromName(legacyName), number: localStorage.getItem("thpos_bank_number") || state.storeSettings?.bankNumber || "", owner: localStorage.getItem("thpos_bank_owner") || state.storeSettings?.bankOwner || "" };
  const qr = $("qr");
  const qrKey = `${state.payment}|${bank.id}|${bank.code}|${bank.number}|${Math.round(Number(total) || 0)}`;
  if (state.qrKey === qrKey) return;
  state.qrKey = qrKey;
  if (qr) {
    qr.innerHTML = "";
    if (bank.code && bank.number) {
      const img = document.createElement("img");
      img.alt = "VietQR thanh toán";
      img.src = vietQrUrl(bank, total);
      qr.appendChild(img);
    }
  }
  $("qrText").textContent = bank.code && bank.number ? `${bank.name} · ${bank.number} · ${bank.owner}` : "Hãy lưu tài khoản nhận trong Cài đặt";
}

function renderBankOptions(selected = "") {
  const select = $("bankName");
  if (!select || select.tagName !== "SELECT") return;
  select.innerHTML = '<option value="">Chọn ngân hàng</option>' + bankOptions.map(([code, name]) => `<option value="${esc(name)}" data-bin="${code}">${esc(name)}</option>`).join("");
  select.value = selected;
  const option = select.selectedOptions[0];
  if (option?.dataset.bin && $("bankCode")) $("bankCode").value = option.dataset.bin;
}

function renderPaymentAccounts() {
  const accounts = state.storeSettings?.bankAccounts || [];
  const select = $("bankSelect");
  const active = localStorage.getItem("thpos_active_bank") || accounts[0]?.id || "";
  if (select) {
    select.innerHTML = accounts.length ? accounts.map(account => `<option value="${esc(account.id)}">${esc(account.name)} · ${esc(account.number)} · ${esc(account.owner)}</option>`).join("") : '<option value="">Chưa có tài khoản nhận</option>';
    select.value = accounts.some(account => account.id === active) ? active : accounts[0]?.id || "";
  }
  const box = $("bankManage");
  if (box) box.innerHTML = accounts.map(account => `<div class="bank-tag"><div><b>${esc(account.name)}</b><small>${esc(account.number)} · ${esc(account.owner)}</small></div><button type="button" class="danger" data-bank-delete="${esc(account.id)}">Xóa</button></div>`).join("") || '<span class="muted">Chưa lưu tài khoản nào.</span>';
}

$("bankName")?.addEventListener("change", e => {
  const code = e.target.selectedOptions[0]?.dataset.bin || "";
  if ($("bankCode")) $("bankCode").value = code;
  renderCart();
});
$("bankSelect")?.addEventListener("change", e => { localStorage.setItem("thpos_active_bank", e.target.value); state.qrKey = ""; renderCart(); });

function vietQrUrl(bank, total) {
  const amount = Math.max(0, Math.round(Number(total) || 0));
  const addInfo = `POS ${Date.now()}`;
  return `https://img.vietqr.io/image/${encodeURIComponent(bank.code)}-${encodeURIComponent(bank.number)}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(addInfo)}&accountName=${encodeURIComponent(bank.owner || "")}`;
}

function bankBinFromName(name) {
  const key = String(name || "").toLowerCase().replace(/[ ._-]/g, "");
  const bins = {
    mb: "970422", mbbank: "970422", vietcombank: "970436", vcb: "970436", bidv: "970418",
    agribank: "970405", vietinbank: "970415", techcombank: "970407", acb: "970416",
    sacombank: "970403", vpbank: "970432", tpbank: "970423", hdbank: "970437",
    shb: "970443", seabank: "970440", ocb: "970448", msb: "970426", eximbank: "970431",
    bacabank: "970409", namabank: "970428", vnpay: "970434"
  };
  return bins[key] || "";
}

function printReceipt(order) {
  const w = window.open("", "_blank", "width=420,height=700");
  if (!w) return;
  const store = state.storeSettings || {};
  w.document.write(`<html><head><title>Hóa đơn ${esc(order.id)}</title><style>@page{size:80mm auto;margin:0}*{box-sizing:border-box}html{width:100%;display:flex;justify-content:center}body{font-family:Arial,sans-serif;width:72mm;margin:0 auto;padding:4mm 0;color:#172033;font-size:11px}.brand{text-align:center;border-bottom:1px solid #172033;padding-bottom:8px;margin-bottom:8px}.brand h2{margin:0 0 3px;font-size:21px;letter-spacing:.3px;text-transform:uppercase}.brand p{margin:2px 0;font-size:9px;color:#414b5c}.legal{font-size:10px;font-weight:700}.meta{font-size:9px;line-height:1.5;margin-bottom:6px}.meta b{font-size:10px}table{width:100%;border-collapse:collapse;table-layout:fixed}th{font-size:9px;text-align:left;border-bottom:1px solid #172033;padding:5px 0}th:nth-child(1){width:48%}th:nth-child(2){width:16%;text-align:center}th:nth-child(3){width:36%;text-align:right}td{padding:6px 0;border-bottom:1px dashed #b9c1ce;vertical-align:top;word-wrap:break-word}td:nth-child(2){text-align:center}.r{text-align:right}.subline{font-size:9px;color:#596579;margin-top:2px}.sum{display:flex;justify-content:space-between;margin-top:7px}.t{font-size:17px;font-weight:800;border-top:1px solid #172033;padding-top:8px;margin:9px 0 0}.thanks{text-align:center;border-top:1px dashed #aab3c1;margin-top:12px;padding-top:9px;font-size:10px;color:#596579}@media print{html,body{width:80mm;margin:0 auto}body{padding:3mm 4mm}}</style></head><body><div class="brand"><h2>${esc(store.storeName || store.businessName || "TẠP HÓA POS")}</h2>${store.businessName ? `<p class="legal">HKD: ${esc(store.businessName)}</p>` : ""}${store.businessAddress ? `<p>${esc(store.businessAddress)}</p>` : ""}${store.businessPhone ? `<p>ĐT: ${esc(store.businessPhone)}</p>` : ""}${store.taxCode ? `<p>MST: ${esc(store.taxCode)}</p>` : ""}${store.businessSlogan ? `<p>${esc(store.businessSlogan)}</p>` : ""}</div><div class="meta"><b>HÓA ĐƠN BÁN HÀNG</b><br>Mã HĐ: ${esc(order.id)}<br>Thời gian: ${new Date().toLocaleString('vi-VN')}<br>Máy: ${esc(machineId)}</div><table><thead><tr><th>Mặt hàng</th><th>SL</th><th>Thành tiền</th></tr></thead><tbody>${order.items.map(i => `<tr><td>${esc(i.name)}<div class="subline">${esc(i.unit)} x ${money(i.price)}</div></td><td>${i.qty}</td><td class="r">${money(i.qty * i.price)}</td></tr>`).join("")}</tbody></table><div class="sum"><span>Tạm tính</span><b>${money(order.subtotal)}</b></div><div class="sum"><span>Giảm giá</span><b>${money(order.discount)}</b></div><p class="t">TỔNG: ${money(order.total)}</p><div class="sum"><span>Thanh toán</span><b>${order.paymentMethod === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}</b></div><div class="thanks">${esc(store.businessSlogan || "Cảm ơn quý khách và hẹn gặp lại!")}</div></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

// ----- PHẦN 12: CUSTOMER SCREEN -----
function updateCustomerScreen(total) {
  const store = state.storeSettings || {};
  const bankName = localStorage.getItem("thpos_bank_name") || store.bankName || "";
  const bank = { name: bankName, code: localStorage.getItem("thpos_bank_code") || store.bankCode || bankBinFromName(bankName), number: localStorage.getItem("thpos_bank_number") || store.bankNumber || "", owner: localStorage.getItem("thpos_bank_owner") || store.bankOwner || "" };
  const data = { customer: $("customerSelect")?.selectedOptions?.[0]?.text || "Khách lẻ", items: state.cart, total, subtotal: state.cart.reduce((sum, item) => sum + item.qty * item.price, 0), paymentMethod: state.payment, qrData: state.payment === "transfer" && bank.code && bank.number ? vietQrUrl(bank, total) : "", bankName: bank.name, bankOwner: bank.owner, store: { ...store, ...bank } };
  try { localStorage.setItem("thpos_customer_screen", JSON.stringify(data)); } catch (_) { }
  window.customerScreen?.postMessage({ type: "pos-update", data }, "*");
}
$("customerScreenBtn")?.addEventListener("click", openCustomerScreen);
$("customerScreenTop")?.addEventListener("click", openCustomerScreen);
function openCustomerScreen() { window.customerScreen = window.open("customer-screen.html", "THPOS_CUSTOMER", "width=1100,height=750"); }

// ----- PHẦN 13: DASHBOARD (LEGACY) -----
function renderDashboard() {
  const paid = state.orders.filter(o => (o.status === "paid" || o.status === "completed") && inPeriod(o, state.dashboardPeriod || "day"));
  $("dRevenue").textContent = money(paid.reduce((a, o) => a + Number(o.total || 0), 0));
  $("dOrders").textContent = paid.length;
  $("dProfit").textContent = money(paid.reduce((a, o) => a + Number(o.total || 0) - o.items?.reduce((x, i) => x + Number(i.cost || 0) * Number(i.qty || 0), 0), 0));
  $("dStock").textContent = money(state.products.reduce((a, p) => a + (Number(p.stockBase || 0) * (Number(preferredUnit(p).cost || 0) / (Number(preferredUnit(p).factor) || 1))), 0));
  $("topProducts").innerHTML = topProducts(paid).map((x, i) => `<div class="low-item"><span>${i + 1}. ${esc(x.name)}</span><b>${x.qty}</b></div>`).join("") || '<div class="low-item">Chưa có dữ liệu.</div>';
  $("recentOrders").innerHTML = paid.slice(0, 5).map(o => `<div class="low-item"><span>${esc(o.id)}</span><b>${money(o.total)}</b></div>`).join("") || '<div class="low-item">Chưa có đơn.</div>';
  $("lowStockList").innerHTML = state.products.filter(p => (Number(p.stockBase) || 0) <= Number(p.lowStock || 0)).slice(0, 8).map(p => `<div class="low-item"><span>${esc(p.name)}</span><b class="warning">${p.stockBase || 0}</b></div>`).join("") || '<div class="low-item">Kho đang ổn.</div>';
}

function topProducts(os) {
  const m = {};
  os.forEach(o => (o.items || []).forEach(i => { m[i.name] = (m[i.name] || 0) + Number(i.qty || 0); }));
  return Object.entries(m).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 8);
}

// ----- PHẦN 14: ORDERS PAGE -----
function renderOrders() {
  const q = ($("orderSearch")?.value || "").toLowerCase();
  $("orderTable").innerHTML = state.orders.filter(o => !q || String(o.id).toLowerCase().includes(q) || String(o.customerId || "").toLowerCase().includes(q)).map(o => `
    <tr>
      <td>${esc(o.id)}</td>
      <td>${o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('vi-VN') : ''}</td>
      <td>${esc(o.customerId || 'Khách lẻ')}</td>
      <td>${(o.items || []).reduce((a, i) => a + Number(i.qty || 0), 0)}</td>
      <td>${money(o.total)}</td>
      <td>${money(Number(o.total || 0) - (o.items || []).reduce((a, i) => a + Number(i.cost || 0) * Number(i.qty || 0), 0))}</td>
      <td>${o.status === 'pending_transfer' ? 'Chờ chuyển khoản' : 'Đã thanh toán'}</td>
      <td></td>
    </tr>
  `).join("");
}
$("orderSearch")?.addEventListener("input", debounce(renderOrders));

// ----- PHẦN 15: CUSTOMERS PAGE -----
function renderCustomers() {
  const q = ($("customerPageSearch")?.value || "").toLowerCase();
  $("customerList").innerHTML = state.customers.filter(c => !q || String(c.name || "").toLowerCase().includes(q) || String(c.phone || "").includes(q)).map(c => `
    <div class="customer-row">
      <div><b>${esc(c.name || "Không tên")}</b><small>${esc(c.phone || "")}</small></div>
      <div><button class="soft" data-cust-edit="${c.id}">Sửa</button> <button class="danger" data-cust-del="${c.id}">Xóa</button></div>
    </div>
  `).join("") || '<div class="empty-detail">Chưa có khách hàng.</div>';
}
$("customerPageSearch")?.addEventListener("input", debounce(renderCustomers));
$("customerList")?.addEventListener("click", async e => {
  const ed = e.target.closest('[data-cust-edit]');
  const dl = e.target.closest('[data-cust-del]');
  if (ed) {
    const c = state.customers.find(x => x.id === ed.dataset.custEdit);
    if (!c) return;
    const name = prompt('Tên khách hàng:', c.name || '');
    if (!name) return;
    const phone = prompt('Số điện thoại:', c.phone || '') || '';
    const r = await updateCustomer(c.id, { name, phone });
    toast(r.success ? 'Đã cập nhật khách hàng' : r.error, !r.success ? false : true);
  }
  if (dl && confirm('Xóa khách hàng này?')) {
    const r = await deleteCustomer(dl.dataset.custDel);
    toast(r.success ? 'Đã xóa khách hàng' : r.error, !r.success ? false : true);
  }
});
$("addCustomerBtn")?.addEventListener("click", () => promptCustomer());
$("addCustomerPageBtn")?.addEventListener("click", promptCustomer);
async function promptCustomer() {
  const name = prompt("Tên khách hàng:");
  if (!name) return;
  const phone = prompt("Số điện thoại:") || "";
  const r = await addCustomer({ name, phone });
  if (r.success) toast("Đã thêm khách hàng"); else toast(r.error, false);
}

function renderCustomerSelect() {
  const s = $("customerSelect");
  if (s) s.innerHTML = '<option value="">Khách lẻ</option>' + state.customers.map(c => `<option value="${c.id}">${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`).join("");
}

// ----- PHẦN 16: SUPPLIERS -----
$("addSupplierBtn")?.addEventListener("click", async () => {
  const name = prompt("Tên nhà cung cấp:");
  if (!name) return;
  const phone = prompt("Số điện thoại:") || "";
  const address = prompt("Địa chỉ:") || "";
  const note = prompt("Ghi chú:") || "";
  const r = await addSupplier({ name, phone, address, note });
  if (r.success) toast("Đã thêm nhà cung cấp"); else toast(r.error, false);
});

function renderSuppliers() {
  const q = ($("supplierSearch")?.value || "").toLowerCase();
  $("supplierTable").innerHTML = state.suppliers.filter(s => !q || String(s.name || "").toLowerCase().includes(q) || String(s.phone || "").includes(q)).map(s => `
    <div class="customer-row">
      <div><b>${esc(s.name)}</b><small>${esc(s.phone || "")} · ${esc(s.address || "")} ${s.note ? '· ' + esc(s.note) : ''}</small></div>
      <div><button class="soft" data-sup-edit="${s.id}">Sửa</button> <button class="danger" data-sup-del="${s.id}">Xóa</button></div>
    </div>
  `).join("") || "Chưa có nhà cung cấp.";
}
$("supplierSearch")?.addEventListener("input", debounce(renderSuppliers));
$("supplierTable")?.addEventListener("click", async e => {
  const ed = e.target.closest('[data-sup-edit]');
  const dl = e.target.closest('[data-sup-del]');
  if (ed) {
    const x = state.suppliers.find(v => v.id === ed.dataset.supEdit);
    if (!x) return;
    const name = prompt('Tên nhà cung cấp:', x.name || '');
    if (!name) return;
    const phone = prompt('Số điện thoại:', x.phone || '') || '';
    const address = prompt('Địa chỉ:', x.address || '') || '';
    const note = prompt('Ghi chú:', x.note || '') || '';
    const r = await updateSupplier(x.id, { name, phone, address, note });
    toast(r.success ? 'Đã cập nhật nhà cung cấp' : r.error, !r.success ? false : true);
  }
  if (dl && confirm('Xóa nhà cung cấp này?')) {
    const r = await deleteSupplier(dl.dataset.supDel);
    toast(r.success ? 'Đã xóa nhà cung cấp' : r.error, !r.success ? false : true);
  }
});

// ----- PHẦN 17: EXPENSES -----
$("saveExpenseBtn")?.addEventListener("click", async () => {
  const amount = Number($("expenseAmount").value) || 0;
  if (amount <= 0) { toast("Số tiền không hợp lệ.", false); return; }
  const r = await addExpense({ date: $("expenseDate").value, category: $("expenseCategory").value, amount, note: $("expenseNote").value });
  if (r.success) { toast("Đã lưu chi phí"); $("expenseAmount").value = ""; } else toast(r.error, false);
});

function renderExpenses() {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  $("expenseTodayTotal").textContent = money(state.expenses.filter(x => x.date === today).reduce((a, x) => a + Number(x.amount || 0), 0));
  $("expenseMonthTotal").textContent = money(state.expenses.filter(x => String(x.date || "").startsWith(month)).reduce((a, x) => a + Number(x.amount || 0), 0));
  $("expenseTable").innerHTML = state.expenses.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(x => `
    <div class="customer-row">
      <div><b>${esc(x.date || "")} · ${esc(x.category || "")}</b><small>${esc(x.note || "")}</small></div>
      <div><b>${money(x.amount)}</b> <button class="danger" data-exp-del="${x.id}">Xóa</button></div>
    </div>
  `).join("") || "Chưa có chi phí.";
}
$("expenseTable")?.addEventListener("click", async e => {
  const b = e.target.closest('[data-exp-del]');
  if (!b || !confirm('Xóa khoản chi này?')) return;
  const r = await deleteExpense(b.dataset.expDel);
  toast(r.success ? 'Đã xóa khoản chi' : r.error, !r.success ? false : true);
});

// ----- PHẦN 18: SETTINGS / BANK -----
$("addBankBtn")?.addEventListener("click", async () => {
  if (!$("bankName").value || !$("bankNumber").value.trim() || !$("bankOwner").value.trim()) {
    toast("Hãy chọn ngân hàng, nhập số tài khoản và tên chủ tài khoản.", false);
    return;
  }
  const account = { id: crypto.randomUUID ? crypto.randomUUID() : "bank-" + Date.now(), name: $("bankName").value.trim(), code: $("bankCode").value.trim(), number: $("bankNumber").value.trim(), owner: $("bankOwner").value.trim() };
  const accounts = [...(state.storeSettings?.bankAccounts || []).filter(item => item.number !== account.number), account];
  const result = await saveSettings({ bankAccounts: accounts });
  if (!result.success) { toast(result.error, false); return; }
  state.storeSettings = { ...state.storeSettings, bankAccounts: accounts };
  localStorage.setItem("thpos_active_bank", account.id);
  localStorage.setItem("thpos_bank_name", $("bankName").value.trim());
  localStorage.setItem("thpos_bank_code", $("bankCode").value.trim());
  localStorage.setItem("thpos_bank_number", $("bankNumber").value.trim());
  localStorage.setItem("thpos_bank_owner", $("bankOwner").value.trim());
  renderPaymentAccounts();
  toast("Đã lưu tài khoản nhận");
  renderCart();
});
$("bankManage")?.addEventListener("click", async event => {
  const button = event.target.closest("[data-bank-delete]");
  if (!button || !confirm("Xóa tài khoản nhận này?")) return;
  const accounts = (state.storeSettings?.bankAccounts || []).filter(account => account.id !== button.dataset.bankDelete);
  const result = await saveSettings({ bankAccounts: accounts });
  if (!result.success) { toast(result.error, false); return; }
  state.storeSettings = { ...state.storeSettings, bankAccounts: accounts };
  localStorage.removeItem("thpos_active_bank");
  renderPaymentAccounts();
  state.qrKey = "";
  renderCart();
  toast("Đã xóa tài khoản nhận");
});

// ----- PHẦN 19: V5.3+ FEATURE PACK (charts, reports, notifications, settings) -----
function dateValue(x) { if (!x) return null; if (x.toDate) return x.toDate(); const d = new Date(x); return isNaN(d) ? null : d; }
function inPeriod(o, period) {
  const d = dateValue(o.createdAt) || new Date();
  const now = new Date();
  let from = new Date(now);
  if (period === 'day') from.setHours(0, 0, 0, 0);
  else if (period === 'week') from.setDate(now.getDate() - 6);
  else if (period === 'month') from.setDate(1);
  else if (period === 'quarter') from.setMonth(Math.floor(now.getMonth() / 3) * 3, 1);
  else if (period === 'year') { from.setMonth(0, 1); from.setHours(0, 0, 0, 0); }
  else if (period === 'all') return true;
  return d >= from;
}
document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-period]').forEach(item => item.classList.toggle('active', item === button));
  state.dashboardPeriod = button.dataset.period;
  renderDashboardV53();
}));

function renderSalesChart() {
  const el = $("salesChart");
  if (!el) return;
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push(d); }
  const vals = days.map(d => state.orders.filter(o => (o.status === 'paid' || o.status === 'completed') && ((dateValue(o.createdAt) || new Date()).toDateString() === d.toDateString())).reduce((a, o) => a + Number(o.total || 0), 0));
  const max = Math.max(1, ...vals);
  el.innerHTML = days.map((d, i) => `
    <div class="chart-col">
      <div class="chart-value">${money(vals[i])}</div>
      <div class="chart-bar" style="height:${Math.max(8, vals[i] / max * 150)}px"></div>
      <small>${d.getDate()}/${d.getMonth() + 1}</small>
    </div>
  `).join('');
}

function renderDashboardV53() {
  renderDashboard();
  renderSalesChart();
  const paid = state.orders.filter(o => o.status === 'paid' || o.status === 'completed');
  const best = topProducts(paid);
  if ($("topProducts")) $("topProducts").innerHTML = best.map((x, i) => `<div class="low-item"><span>${i + 1}. ${esc(x.name)}</span><b>${x.qty}</b></div>`).join('') || '<div class="low-item">Chưa có dữ liệu.</div>';
}

function renderReportsV53() {
  const period = $("reportPeriod")?.value || 'day';
  const orders = state.orders.filter(o => (o.status === 'paid' || o.status === 'completed') && inPeriod(o, period));
  const revenue = orders.reduce((a, o) => a + Number(o.total || 0), 0);
  const cost = orders.reduce((a, o) => a + (o.items || []).reduce((x, i) => x + Number(i.cost || 0) * Number(i.qty || 0), 0), 0);
  const expense = state.expenses.filter(x => {
    if (period === 'all') return true;
    const d = new Date(x.date || 0);
    const now = new Date();
    if (period === 'day') return x.date === now.toISOString().slice(0, 10);
    if (period === 'week') { const f = new Date(); f.setDate(now.getDate() - 6); return d >= f; }
    if (period === 'month') return String(x.date || '').startsWith(now.toISOString().slice(0, 7));
    if (period === 'quarter') return d >= new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    if (period === 'year') return d >= new Date(now.getFullYear(), 0, 1);
    return true;
  }).reduce((a, x) => a + Number(x.amount || 0), 0);
  $("reportRevenue").textContent = money(revenue);
  $("reportCost").textContent = money(cost);
  $("reportExpense").textContent = money(expense);
  $("reportProfit").textContent = money(revenue - cost - expense);
  if ($("reportDetail")) $("reportDetail").innerHTML = `
    <div class="report-row"><span>Số đơn</span><b>${orders.length}</b></div>
    <div class="report-row"><span>Lợi nhuận gộp</span><b>${money(revenue - cost)}</b></div>
    <div class="report-row"><span>Lợi nhuận ròng</span><b>${money(revenue - cost - expense)}</b></div>
  `;
}
$("reportPeriod")?.addEventListener('change', renderReportsV53);

function renderNotificationsV53() {
  const lows = state.products.filter(p => lowState(p).low);
  const box = $("notificationList");
  if (box) box.innerHTML = lows.map(p => `
    <div class="notification-item"><b>⚠ ${esc(p.name)}</b><span>Tồn ${esc(lowState(p).display)} · ngưỡng ${esc(lowState(p).threshold)}</span></div>
  `).join('') || '<div class="empty-detail">Không có cảnh báo tồn kho.</div>';
  if ($("notificationCount")) $("notificationCount").textContent = lows.length;
  if ($("sideNotificationCount")) $("sideNotificationCount").textContent = lows.length;
}

function renderSettingsV53() {
  getSettings().then(cfg => {
    const legacyAccount = cfg.bankName && cfg.bankNumber ? [{ id: "legacy", name: cfg.bankName, code: cfg.bankCode || bankBinFromName(cfg.bankName), number: cfg.bankNumber, owner: cfg.bankOwner || "" }] : [];
    state.storeSettings = { ...cfg, bankAccounts: cfg.bankAccounts?.length ? cfg.bankAccounts : legacyAccount };
    const saved = cfg.unitConfig || { unit1: true, unit2: true, unit3: true };
    state.unitConfig = {
      unit1: saved.unit1 !== false,
      unit2: saved.unit2 !== false,
      unit3: saved.unit3 !== false
    };
    state.unitCache = new WeakMap();
    state.qrKey = "";
    if ($("unitToggle1")) $("unitToggle1").checked = state.unitConfig.unit1;
    if ($("unitToggle2")) $("unitToggle2").checked = state.unitConfig.unit2;
    if ($("unitToggle3")) $("unitToggle3").checked = state.unitConfig.unit3;
    if ($("businessName")) $("businessName").value = cfg.businessName || '';
    if ($("storeName")) $("storeName").value = cfg.storeName || '';
    if ($("businessPhone")) $("businessPhone").value = cfg.businessPhone || '';
    if ($("businessAddress")) $("businessAddress").value = cfg.businessAddress || '';
    if ($("taxCode")) $("taxCode").value = cfg.taxCode || '';
    if ($("businessSlogan")) $("businessSlogan").value = cfg.businessSlogan || '';
    if ($("bankName")) $("bankName").value = cfg.bankName || '';
    if ($("bankCode")) $("bankCode").value = cfg.bankCode || '';
    if ($("bankNumber")) $("bankNumber").value = cfg.bankNumber || '';
    if ($("bankOwner")) $("bankOwner").value = cfg.bankOwner || '';
    renderBankOptions(cfg.bankName || "");
    renderPaymentAccounts();
    const cats = cfg.categories || [];
    if ($("categoryManage")) $("categoryManage").innerHTML = cats.map(c => `<span class="tag">${esc(c)} <button data-cat-del="${esc(c)}">×</button></span>`).join('');
  });
}

async function saveStoreSettingsV53() {
  state.unitConfig = {
    unit1: $("unitToggle1") ? $("unitToggle1").checked : true,
    unit2: $("unitToggle2") ? $("unitToggle2").checked : true,
    unit3: $("unitToggle3") ? $("unitToggle3").checked : true
  };
  const settings = {
    unitConfig: state.unitConfig,
    storeName: $("storeName").value.trim(),
    businessName: $("businessName").value.trim(),
    businessPhone: $("businessPhone").value.trim(),
    businessAddress: $("businessAddress").value.trim(),
    taxCode: $("taxCode").value.trim(),
    businessSlogan: $("businessSlogan").value.trim(),
    bankName: $("bankName").value.trim(),
    bankCode: $("bankCode").value.trim(),
    bankNumber: $("bankNumber").value.trim(),
    bankOwner: $("bankOwner").value.trim()
  };
  state.storeSettings = { ...state.storeSettings, ...settings };
  const r = await saveSettings(settings);
  if (r.success) {
    localStorage.setItem('thpos_bank_name', $("bankName").value.trim());
    localStorage.setItem('thpos_bank_code', $("bankCode").value.trim());
    localStorage.setItem('thpos_bank_number', $("bankNumber").value.trim());
    localStorage.setItem('thpos_bank_owner', $("bankOwner").value.trim());
    toast('Đã lưu cài đặt lên Firestore');
  } else toast(r.error, false);
}

async function addCategoryV53() {
  const c = $("categoryInput").value.trim();
  if (!c) return;
  const cfg = await getSettings();
  const cats = [...(cfg.categories || [])];
  if (cats.some(x => x.toLowerCase() === c.toLowerCase())) return toast('Danh mục đã tồn tại.', false);
  const r = await saveSettings({ categories: [...cats, c] });
  if (r.success) { $("categoryInput").value = ''; toast('Đã thêm danh mục'); renderSettingsV53(); } else toast(r.error, false);
}
$("saveBusinessBtn")?.addEventListener('click', saveStoreSettingsV53);
$("addCategoryBtn")?.addEventListener('click', addCategoryV53);
$("categoryManage")?.addEventListener('click', async e => {
  const b = e.target.closest('[data-cat-del]');
  if (!b) return;
  const cfg = await getSettings();
  const r = await saveSettings({ categories: (cfg.categories || []).filter(c => c !== b.dataset.catDel) });
  if (r.success) renderSettingsV53();
});
$("notificationBtn")?.addEventListener('click', () => setPage('notifications'));

function downloadBlob(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

// ----- PHẦN 20: EXCEL IMPORT/EXPORT -----
$("downloadTemplate")?.addEventListener('click', () => {
  const headers = ['barcode', 'name', 'category', 'preferredUnit', 'unit1', 'unit1Factor', 'unit1Cost', 'unit1Price', 'unit2', 'unit2Factor', 'unit2Cost', 'unit2Price', 'unit3', 'unit3Factor', 'unit3Cost', 'unit3Price', 'stockBase', 'lowStock'];
  const ws = XLSX.utils.json_to_sheet([Object.fromEntries(headers.map(h => [h, '']))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  XLSX.writeFile(wb, 'TapHoaPOS_Template.xlsx');
});

let importRows = [];
$("excelFile")?.addEventListener('change', async e => {
  const f = e.target.files?.[0];
  if (!f) return;
  const data = await f.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  importRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  $("importPreview").innerHTML = `<div class="muted">Đã đọc ${importRows.length} dòng.</div><pre>${esc(JSON.stringify(importRows.slice(0, 8), null, 2))}</pre>`;
  $("confirmImport").classList.toggle('hidden', !importRows.length);
});
$("confirmImport")?.addEventListener('click', async () => {
  let ok = 0;
  for (const row of importRows) {
    if (!row.name) continue;
    const d = { ...row, barcode: normalizeBarcode(row.barcode), stockBase: Number(row.stockBase) || 0, lowStock: Number(row.lowStock) || 0 };
    for (let i = 1; i <= 3; i++) { d['unit' + i] = String(d['unit' + i] || '').trim(); d['unit' + i + 'Factor'] = Number(d['unit' + i + 'Factor']) || 1; d['unit' + i + 'Cost'] = Number(d['unit' + i + 'Cost']) || 0; d['unit' + i + 'Price'] = Number(d['unit' + i + 'Price']) || 0; }
    d.preferredUnit = d.preferredUnit || d.unit1;
    const old = findProduct(d.barcode);
    const r = old ? await updateProduct(old.id, d) : await addProduct(d);
    if (r.success) ok++;
  }
  toast(`Đã nhập ${ok}/${importRows.length} sản phẩm`);
});
$("exportExcel")?.addEventListener('click', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.products), 'Products');
  XLSX.writeFile(wb, 'TapHoaPOS_Products.xlsx');
});
$("exportOrdersBtn")?.addEventListener('click', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.orders.map(o => ({ id: o.id, status: o.status, total: o.total, machineId: o.machineId, customerId: o.customerId }))), 'Orders');
  XLSX.writeFile(wb, 'TapHoaPOS_Orders.xlsx');
});
$("exportExpensesBtn")?.addEventListener('click', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.expenses), 'Expenses');
  XLSX.writeFile(wb, 'TapHoaPOS_Expenses.xlsx');
});

// ----- PHẦN 21: ORDER CONTROLS (print/cancel) -----
function renderOrdersV53() {
  const q = ($('orderSearch')?.value || '').toLowerCase();
  $('orderTable').innerHTML = state.orders.filter(o => !q || String(o.id).toLowerCase().includes(q) || String(o.customerId || '').toLowerCase().includes(q)).map(o => `
    <tr>
      <td>${esc(o.id)}</td>
      <td>${dateValue(o.createdAt)?.toLocaleString('vi-VN') || ''}</td>
      <td>${esc(o.customerId || 'Khách lẻ')}</td>
      <td>${(o.items || []).reduce((a, i) => a + Number(i.qty || 0), 0)}</td>
      <td>${money(o.total)}</td>
      <td>${money(Number(o.total || 0) - (o.items || []).reduce((a, i) => a + Number(i.cost || 0) * Number(i.qty || 0), 0))}</td>
      <td>${o.status === 'cancelled' ? 'Đã hủy' : o.status === 'pending_transfer' ? 'Chờ chuyển khoản' : 'Đã thanh toán'}</td>
      <td>${o.status === 'cancelled' ? '' : `<button class="soft" data-print-order="${o.id}">In</button> <button class="danger" data-cancel-order="${o.id}">Hủy + hoàn kho</button>`}</td>
    </tr>
  `).join('');
}
$("orderTable")?.addEventListener('click', async e => {
  const pr = e.target.closest('[data-print-order]');
  if (pr) { const o = state.orders.find(x => x.id === pr.dataset.printOrder); if (o) printReceipt(o); }
  const ca = e.target.closest('[data-cancel-order]');
  if (ca && confirm('Hủy đơn và hoàn lại tồn kho?')) {
    const r = await cancelOrder(ca.dataset.cancelOrder);
    toast(r.success ? 'Đã hủy đơn và hoàn kho' : r.error, !r.success ? false : true);
  }
});
$("markNotificationsRead")?.addEventListener('click', () => toast('Đã đánh dấu thông báo đã xem'));

// ----- PHẦN 22: EXTRA CONTROLS (find customer, receive quick, open QR, change password, backup, reset demo) -----
function bindExtraControls() {
  $("findCustomerBtn")?.addEventListener("click", () => { setPage("customers"); setTimeout(() => $("customerPageSearch")?.focus(), 50); });
  $("receiveQuickBtn")?.addEventListener("click", () => { setPage("inventory"); setTimeout(() => $("receiveBarcodeInput")?.focus(), 50); });
  $("openQrBtn")?.addEventListener("click", () => {
    const bank = $("bankSelect")?.value || "";
    const q = $("qr")?.innerHTML || "";
    if (!q) { toast("Chưa có QR để mở.", false); return; }
    const w = window.open("", "THPOS_QR", "width=520,height=620");
    if (w) { w.document.write(`<html><head><title>QR thanh toán</title></head><body style="font-family:Arial;text-align:center;padding:30px"><h2>QR thanh toán</h2><div>${q}</div><p>${bank}</p></body></html>`); w.document.close(); }
  });
  $("changePasswordBtn")?.addEventListener("click", async () => {
    const email = auth.currentUser?.email;
    if (!email) { toast("Chưa đăng nhập.", false); return; }
    const r = await import("../firebase-config.js").then(m => m.resetPassword(email));
    toast(r.success ? "Đã gửi email đổi mật khẩu" : r.error, !r.success ? false : true);
  });
  $("backupDataBtn")?.addEventListener("click", () => {
    const payload = { version: "V5.3", exportedAt: new Date().toISOString(), products: state.products, orders: state.orders, customers: state.customers, suppliers: state.suppliers, expenses: state.expenses };
    downloadBlob("TapHoaPOS_Backup.json", JSON.stringify(payload, null, 2), "application/json");
    toast("Đã sao lưu dữ liệu trên máy.");
  });
  $("resetDemoBtn")?.addEventListener("click", async () => {
    if (!confirm("Khôi phục dữ liệu mẫu trên Firestore? Dữ liệu hiện tại không tự bị xóa.")) return;
    const samples = [
      { barcode: "8938505970012", name: "Coca-Cola 330ml", category: "Nước ngọt", unit1: "Lon", unit1Factor: 1, unit1Cost: 7000, unit1Price: 10000, unit2: "Lốc", unit2Factor: 6, unit2Cost: 42000, unit2Price: 60000, unit3: "Thùng", unit3Factor: 24, unit3Cost: 168000, unit3Price: 240000, preferredUnit: "Lon", stockBase: 240, lowStock: 24, active: true },
      { barcode: "8934588001234", name: "Mì tôm", category: "Thực phẩm", unit1: "Gói", unit1Factor: 1, unit1Cost: 3500, unit1Price: 5000, preferredUnit: "Gói", stockBase: 100, lowStock: 20, active: true },
      { barcode: "8935049500018", name: "Nước suối 500ml", category: "Nước uống", unit1: "Chai", unit1Factor: 1, unit1Cost: 4000, unit1Price: 6000, unit2: "Lốc", unit2Factor: 6, unit2Cost: 24000, unit2Price: 33000, unit3: "Thùng", unit3Factor: 24, unit3Cost: 96000, unit3Price: 120000, preferredUnit: "Chai", stockBase: 120, lowStock: 24, active: true },
      { barcode: "8936017360015", name: "Bánh quy bơ", category: "Bánh kẹo", unit1: "Gói", unit1Factor: 1, unit1Cost: 12000, unit1Price: 18000, unit2: "Thùng", unit2Factor: 12, unit2Cost: 144000, unit2Price: 210000, preferredUnit: "Gói", stockBase: 60, lowStock: 12, active: true },
      { barcode: "8934822500019", name: "Nước giặt 3.8kg", category: "Gia dụng", unit1: "Túi", unit1Factor: 1, unit1Cost: 88000, unit1Price: 110000, preferredUnit: "Túi", stockBase: 18, lowStock: 4, active: true },
      { barcode: "8938501000023", name: "Khăn giấy hộp", category: "Gia dụng", unit1: "Hộp", unit1Factor: 1, unit1Cost: 18000, unit1Price: 25000, unit2: "Thùng", unit2Factor: 20, unit2Cost: 360000, unit2Price: 450000, preferredUnit: "Hộp", stockBase: 40, lowStock: 10, active: true }
    ];
    let n = 0;
    for (const x of samples) {
      if (!findProduct(x.barcode)) { const r = await addProduct(x); if (r.success) n++; }
    }
    toast(`Đã khôi phục ${n} sản phẩm mẫu.`);
  });
}

// ----- PHẦN 23: NAV BINDING, LOGOUT, LISTENERS, AUTH -----
function bindNav() {
  if (window.__THPOS_NAV_BOUND) return;
  window.__THPOS_NAV_BOUND = true;
  
  // Attach navigation listeners
  const navButtons = document.querySelectorAll(".nav[data-page]");
  navButtons.forEach(b => b.addEventListener("click", () => setPage(b.dataset.page)));
  
  // Attach quick action listeners
  const quickButtons = document.querySelectorAll("[data-quick]");
  quickButtons.forEach(b => b.addEventListener("click", () => setPage(b.dataset.quick)));
  
  // Attach logout listeners
  $("logoutBtn")?.addEventListener("click", doLogout);
  $("sideLogout")?.addEventListener("click", doLogout);
  
  // Attach settings button
  $("settingsTopBtn")?.addEventListener("click", () => setPage("settings"));
  
  // Attach clear cart button
  $("clearCart")?.addEventListener("click", () => { state.cart = []; renderCart(); });
  
  // Bind extra controls
  bindExtraControls();
}
bindNav();

async function doLogout() { await logoutUser(); location.href = "index.html"; }

function startListeners() {
  loadCachedProducts();
  function applyProducts(ps) {
    setProducts(ps);
    const validIds = new Set(state.products.map(product => product.id));
    state.cart = state.cart.filter(item => validIds.has(item.productId));
    renderCart();
    if (state.page === "sale") renderSale();
    if (state.page === "products") renderProducts();
    if (state.page === "inventory") renderInventory();
    if (state.page === "dashboard") renderDashboardV53();
    renderNotificationsV53();
  }
  listenProducts(ps => {
    applyProducts(ps);
  });
  loadProductsNow().catch(error => {
    if (state.page === "sale") {
      const grid = $("productGrid");
      if (grid) grid.innerHTML = '<div class="product-loading product-error">Không tải được sản phẩm. Hãy tải lại trang.</div>';
    }
    console.error("Product load error", error);
  });
  listenOrders(os => { state.orders = os; if (state.page === "orders") renderOrdersV53(); if (state.page === "dashboard") renderDashboardV53(); if (state.page === "reports") renderReportsV53(); });
  listenCustomers(cs => { state.customers = cs; renderCustomerSelect(); if (state.page === "customers") renderCustomers(); });
  getSuppliers().then(x => { state.suppliers = x; if (state.page === "suppliers") renderSuppliers(); });
  getExpenses().then(x => { state.expenses = x; if (state.page === "expenses") renderExpenses(); if (state.page === "reports") renderReportsV53(); });
  renderSettingsV53();
}
async function loadProductsNow() {
  const products = await getProducts();
  if (products.length) {
    setProducts(products);
    if (state.page === "sale") renderSale();
    if (state.page === "products") renderProducts();
    if (state.page === "inventory") renderInventory();
  } else if (state.page === "sale" && !state.products.length) {
    renderSale();
  }
  return products;
}

// ----- PHẦN 24: ON AUTH STATE -----
onAuthState(async user => {
  try {
    if (!user) { location.href = "index.html"; return; }
    state.cart = [];
    $("userNameTop").textContent = user.displayName || user.email || "Nhân viên";
    $("sideUserName").textContent = user.displayName || user.email || "Nhân viên";
    $("dashboardOwner").textContent = user.displayName || user.email || "Chủ cửa hàng";
    bindNav();
    startListeners();
    setPage("dashboard");
    renderCart();
  } catch (e) { console.error("POS init error", e); toast("Lỗi khởi tạo POS: " + (e?.message || e), false); }
});