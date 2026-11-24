// =============================================
// TẠP HÓA POS V5.4 – APP.JS (HOÀN CHỈNH)
// CHIA NHỎ THÀNH NHIỀU PHẦN ĐỂ DỄ COPY
// =============================================

// ----- PHẦN 1: IMPORT VÀ KHỞI TẠO -----
import {
  auth, onAuthState, logoutUser,
  getOrders, commitSale, receiveStock,
  addProduct, updateProduct, deleteProductFirebase,
  getCustomers, addCustomer, updateCustomer, deleteCustomer,
  listenProducts, listenOrders, listenCustomers,
  addSupplier, updateSupplier, deleteSupplier, getSuppliers,
  addExpense, deleteExpense, getExpenses,
  cancelOrder, getSettings, saveSettings,
  confirmTransfer, collectDebt, listenSuppliers, listenExpenses, listenSettings, onSyncStatus
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
  productById: new Map(),
  unitCache: new WeakMap(),
  orderDrafts: [{ id: "draft-1", label: "Đơn 1", cart: [], customerId: "", payment: "cash", discount: 0, debtPaidNow: 0, payRef: "" }],
  activeDraftId: "draft-1",
  nextDraftNumber: 2,
  checkoutInProgress: false,
  qrKey: "",
  payRef: "",
  flash: null,
  selectedCustomer: "",
  sync: { ok: true, fromCache: undefined, pending: false, last: 0 }
};

function activeDraft() {
  return state.orderDrafts.find(draft => draft.id === state.activeDraftId) || null;
}

function saveActiveDraft() {
  const draft = activeDraft();
  if (!draft) return;
  draft.cart = state.cart;
  draft.payment = state.payment;
  draft.customerId = $("customerSelect")?.value || "";
  draft.discount = Math.max(0, Number($("discount")?.value) || 0);
  draft.debtPaidNow = Math.max(0, Number($("debtPaidNow")?.value) || 0);
  draft.payRef = state.payRef || "";
}

function makeOrderDraft() {
  const number = state.nextDraftNumber++;
  return { id: `draft-${number}`, label: `Đơn ${number}`, cart: [], customerId: "", payment: "cash", discount: 0, debtPaidNow: 0, payRef: "" };
}

function renderOrderDrafts() {
  const box = $("orderTabs");
  if (!box) return;
  box.innerHTML = state.orderDrafts.map(draft => {
    const count = draft.cart.reduce((total, item) => total + Number(item.qty || 0), 0);
    return `<div class="order-tab-entry ${draft.id === state.activeDraftId ? "active" : ""}">
      <button type="button" class="order-tab ${draft.id === state.activeDraftId ? "active" : ""}" data-order-draft="${esc(draft.id)}" aria-current="${draft.id === state.activeDraftId ? "page" : "false"}"><span>${esc(draft.label)}</span><small>${count} món</small></button>
      <button type="button" class="tab-close" data-close-order="${esc(draft.id)}" aria-label="Xóa ${esc(draft.label)}" title="Xóa đơn">×</button>
    </div>`;
  }).join("") + '<button type="button" class="new-tab" id="newOrderBtn">＋ Đơn mới</button>';
}

function loadOrderDraft(draft) {
  state.activeDraftId = draft.id;
  state.cart = draft.cart;
  state.payment = draft.payment || "cash";
  state.payRef = draft.payRef || "";
  if ($("customerSelect")) $("customerSelect").value = draft.customerId || "";
  if ($("discount")) $("discount").value = draft.discount || 0;
  if ($("debtPaidNow")) $("debtPaidNow").value = draft.debtPaidNow || 0;
  document.querySelectorAll(".pay").forEach(button => button.classList.toggle("active", button.dataset.method === state.payment));
  state.qrKey = "";
  renderOrderDrafts();
  renderCart();
}

function createOrderDraft() {
  if (state.checkoutInProgress) return;
  saveActiveDraft();
  state.flash = null;
  const draft = makeOrderDraft();
  state.orderDrafts.push(draft);
  loadOrderDraft(draft);
  $("barcodeInput")?.focus();
}

function closeOrderDraft(id) {
  if (state.checkoutInProgress) return;
  const draft = state.orderDrafts.find(item => item.id === id);
  if (!draft) return;
  const hasItems = draft.cart.length > 0;
  if (hasItems && !confirm(`Xóa ${draft.label} và toàn bộ mặt hàng trong đơn?`)) return;
  saveActiveDraft();
  state.orderDrafts = state.orderDrafts.filter(item => item.id !== id);
  if (!state.orderDrafts.length) state.orderDrafts.push(makeOrderDraft());
  if (state.activeDraftId === id) loadOrderDraft(state.orderDrafts[0]);
  else renderOrderDrafts();
}

function finishActiveOrderDraft(finishedId = state.activeDraftId) {
  const wasActive = finishedId === state.activeDraftId;
  state.orderDrafts = state.orderDrafts.filter(draft => draft.id !== finishedId);
  if (!state.orderDrafts.length) state.orderDrafts.push(makeOrderDraft());
  if (wasActive) loadOrderDraft(state.orderDrafts[0]);
  else renderOrderDrafts();
}

function clearActiveOrder() {
  if (state.checkoutInProgress) return;
  if (state.cart.length && !confirm("Xóa toàn bộ mặt hàng trong đơn hiện tại?")) return;
  state.flash = null;
  state.cart = [];
  state.payment = "cash";
  state.payRef = "";
  state.qrKey = "";
  if ($("customerSelect")) $("customerSelect").value = "";
  if ($("discount")) $("discount").value = 0;
  if ($("debtPaidNow")) $("debtPaidNow").value = 0;
  document.querySelectorAll(".pay").forEach(button => button.classList.toggle("active", button.dataset.method === "cash"));
  const draft = activeDraft();
  if (draft) { draft.cart = state.cart; draft.payment = "cash"; draft.customerId = ""; draft.discount = 0; draft.debtPaidNow = 0; draft.payRef = ""; }
  renderCart();
}

function reservedBaseQty(productId, except = null) {
  return state.orderDrafts.reduce((total, draft) => total + draft.cart.reduce((sum, item, index) => {
    if (item.productId !== productId || (draft.id === except?.draftId && index === except?.index)) return sum;
    return sum + (Number(item.baseQty) || 0);
  }, 0), 0);
}

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

// ----- V5.5: HELPER DÙNG CHUNG (trạng thái đơn, công nợ, đồng bộ) -----
const isSale = o => ["paid", "completed", "debt"].includes(o.status);
const payLabel = o => ({ cash: "Tiền mặt", transfer: "Chuyển khoản", debt: "Ghi nợ" }[o.paymentMethod] || "Tiền mặt");
const owedOf = o => Math.max(0, (Number(o.debtAmount) || 0) - (Number(o.debtPaid) || 0));
function statusLabel(o) {
  if (o.status === "cancelled") return "Đã hủy";
  if (o.status === "pending_transfer") return "Chờ chuyển khoản";
  if (o.status === "debt") return `Còn nợ ${money(owedOf(o))}`;
  return o.debtAmount ? "Đã thu đủ nợ" : "Đã thanh toán";
}
function customerLabel(o) { return o.customerName || state.customers.find(c => c.id === o.customerId)?.name || (o.customerId ? "Khách đã xóa" : "Khách lẻ"); }
function paintSync() {
  const el = $("syncChip");
  if (!el) return;
  const off = !navigator.onLine || state.sync.ok === false;
  const wait = !off && (state.sync.pending || state.sync.fromCache === true);
  el.className = "sync-chip " + (off ? "off" : wait ? "wait" : "on");
  el.textContent = off ? "● Mất kết nối – đang chờ mạng" : wait ? "● Đang đồng bộ…" : "● Đã đồng bộ" + (state.sync.last ? " · " + new Date(state.sync.last).toLocaleTimeString("vi-VN") : "");
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
    requestAnimationFrame(() => $("barcodeInput")?.focus());
  }
  if (page === "products") renderProducts();
  if (page === "inventory") renderInventory();
  if (page === "orders") renderOrdersV53();
  if (page === "dashboard") renderDashboardV53();
  if (page === "reports") renderReportsV53();
  if (page === "notifications") renderNotificationsV53();
  if (page === "settings") renderSettingsV53();
  if (page === "customers") { renderCustomers(); renderCustomerDetail(); }
  if (page === "suppliers") renderSuppliers();
  if (page === "expenses") renderExpenses();
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
  state.productById = new Map();
  products.forEach(product => {
    const barcode = normalizeBarcode(product.barcode);
    if (barcode) state.productByBarcode.set(barcode, product);
    state.productById.set(product.id, product);
  });
}
function productsCacheKey() {
  return `thpos_products_cache_${auth.currentUser?.uid || "guest"}`;
}
let productsCacheTimer;
function setProducts(products) {
  state.products = Array.isArray(products) ? products : [];
  rebuildProductIndex(state.products);
  state.unitCache = new WeakMap();
  clearTimeout(productsCacheTimer);
  productsCacheTimer = setTimeout(() => {
    try { localStorage.setItem(productsCacheKey(), JSON.stringify(state.products)); } catch (_) { }
  }, 150);
}
function loadCachedProducts() {
  try {
    const cached = JSON.parse(localStorage.getItem(productsCacheKey()) || "[]");
    if (Array.isArray(cached) && cached.length) { setProducts(cached); return true; }
  } catch (_) { }
  return false;
}
function findProduct(barcode) { return state.productByBarcode.get(normalizeBarcode(barcode)); }
function findProductById(id) { return state.productById.get(id); }
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
  if (state.checkoutInProgress) return false;
  state.flash = null;
  const u = unitsOf(p).find(x => x.name === unitName) || preferredUnit(p);
  const base = Number(qty) * u.factor;
  const existing = state.cart.find(x => x.productId === p.id && x.unit === u.name);
  const already = reservedBaseQty(p.id);
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
  const p = findProductById(x.productId);
  const n = x.qty + d;
  if (n <= 0) { removeCart(i); return; }
  const other = reservedBaseQty(x.productId, { draftId: state.activeDraftId, index: i });
  if (other + n * x.factor > (Number(p?.stockBase) || 0)) { toast("Không đủ tồn kho.", false); return; }
  x.qty = n;
  x.baseQty = n * x.factor;
  renderCart();
}

function changeUnit(i, name) {
  const x = state.cart[i];
  const p = findProductById(x.productId);
  const u = unitsOf(p).find(u => u.name === name);
  if (!u) return;
  const other = reservedBaseQty(x.productId, { draftId: state.activeDraftId, index: i });
  if (other + x.qty * u.factor > (Number(p.stockBase) || 0)) { toast("Không đủ tồn kho cho đơn vị này.", false); return; }
  x.unit = u.name;
  x.factor = u.factor;
  x.baseQty = x.qty * u.factor;
  x.price = u.price;
  x.cost = u.cost;
  renderCart();
}

function renderCart() {
  saveActiveDraft();
  renderOrderDrafts();
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
          <select class="unit-select" data-act="unit" data-i="${i}">${unitsOf(findProductById(x.productId) || {}).map(u => `<option ${u.name === x.unit ? 'selected' : ''}>${esc(u.name)}</option>`).join("")}</select>
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
  renderQR(total);
  renderDebtBox(total);
  updateCustomerScreen(total);
}

// ----- PHẦN 5: CART EVENTS -----
$("cart")?.addEventListener("click", e => {
  if (state.checkoutInProgress) return;
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const i = +b.dataset.i;
  if (b.dataset.act === "inc") changeQty(i, 1);
  if (b.dataset.act === "dec") changeQty(i, -1);
  if (b.dataset.act === "remove") removeCart(i);
});

$("cart")?.addEventListener("change", e => { 
  if (state.checkoutInProgress) return;
  if (e.target.dataset.act === "unit") changeUnit(+e.target.dataset.i, e.target.value); 
});

const discountInput = $("discount");
if (discountInput) {
  discountInput.addEventListener("input", renderCart);
  discountInput.addEventListener("change", renderCart);
}
$("customerSelect")?.addEventListener("change", renderCart);
$("debtPaidNow")?.addEventListener("input", renderCart);

$("orderTabs")?.addEventListener("click", e => {
  if (state.checkoutInProgress) return;
  const close = e.target.closest("[data-close-order]");
  if (close) { closeOrderDraft(close.dataset.closeOrder); return; }
  const tab = e.target.closest("[data-order-draft]");
  if (tab && tab.dataset.orderDraft !== state.activeDraftId) {
    saveActiveDraft();
    state.flash = null;
    const draft = state.orderDrafts.find(item => item.id === tab.dataset.orderDraft);
    if (draft) loadOrderDraft(draft);
    return;
  }
  if (e.target.closest("#newOrderBtn")) createOrderDraft();
});

// ----- PHẦN 6: SCANNER LOGIC -----
function scanSale(raw) {
  if (state.checkoutInProgress) { toast("Đang lưu đơn hàng. Vui lòng chờ.", false); return; }
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
  const ps = state.products.filter(p => {
    const category = String(p.category || "").trim();
    const matchesCategory = cat === "all" || (cat === "__uncategorized__" ? !category : category === cat);
    return matchesCategory && (!q || String(p.name || "").toLowerCase().includes(q) || normalizeBarcode(p.barcode).includes(q));
  });
  grid.innerHTML = ps.map(p => {
    const u = preferredUnit(p);
    return `<button class="product-card" data-pid="${p.id}" style="text-align:left">
      <div class="name">${esc(p.name)}</div>
      <div class="price">${money(u.price)}</div>
      <div class="unit-price">${esc(u.name)} · ${esc(p.barcode || "Chưa có mã")}</div>
      <div class="stock">Tồn: ${Number(p.stockBase) || 0}</div>
    </button>`;
  }).join("") || '<div class="product-loading">Không tìm thấy sản phẩm phù hợp.</div>';
  const cats = [...new Set(state.products.map(p => String(p.category || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
  const hasUncategorized = state.products.some(p => !String(p.category || "").trim());
  $("categoryBar").innerHTML = `<button class="category-btn ${state.category === 'all' ? 'active' : ''}" data-cat="all">Tất cả</button>` + cats.map(c => `<button class="category-btn ${state.category === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join("") + (hasUncategorized ? `<button class="category-btn ${state.category === '__uncategorized__' ? 'active' : ''}" data-cat="__uncategorized__">Chưa có danh mục</button>` : "");
}
$("productGrid")?.addEventListener("click", event => {
  if (!event.target.closest("[data-retry-products]")) return;
  renderSale();
});
$("productGrid")?.addEventListener("click", e => { const b = e.target.closest("[data-pid]"); if (b) { const p = findProductById(b.dataset.pid); if (p) addCart(p); } });
$("categoryBar")?.addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (b) { state.category = b.dataset.cat; renderSale(); } });
const renderSaleSearch = debounce(renderSale, 120);
$("productSearch")?.addEventListener("input", renderSaleSearch);

// ----- PHẦN 8: RECEIVE / INVENTORY LOGIC -----
function selectReceiveProduct(id) {
  state.receiveProductId = id;
  const p = findProductById(id);
  if (!p) return;
  const s = $("receiveProduct");
  if (s) { s.value = id; renderReceiveUnits(); }
  if ($("receiveCost")) $("receiveCost").value = Number(preferredUnit(p).cost) || 0;
}

function renderReceiveUnits() {
  const p = findProductById(state.receiveProductId);
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

function productsByCategory(products) {
  const groups = new Map();
  products.forEach(product => {
    const category = String(product.category || "").trim();
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(product);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => !a ? 1 : !b ? -1 : a.localeCompare(b, "vi"))
    .map(([category, items]) => ({
      category: category || "Chưa có danh mục",
      products: items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "vi"))
    }));
}

function renderInventory() {
  const q = ($("inventorySearch")?.value || "").toLowerCase();
  const ps = state.products.filter(p => !q || String(p.name || "").toLowerCase().includes(q) || normalizeBarcode(p.barcode).includes(q));
  $("inventoryTable").innerHTML = productsByCategory(ps).map(group => `
    <tr class="category-section"><td colspan="9">${esc(group.category)} <span>${group.products.length} mặt hàng</span></td></tr>
    ${group.products.map(p => {
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
        <td><button class="pencil" data-edit="${esc(p.id)}">✎</button></td>
      </tr>`;
    }).join("")}
  `).join("") || '<tr><td colspan="9" class="empty-detail">Không tìm thấy mặt hàng.</td></tr>';
  $("invProductCount").textContent = state.products.length;
  $("invStockCount").textContent = state.products.reduce((a, p) => a + (Number(p.stockBase) || 0), 0);
  $("invStockValue").textContent = money(state.products.reduce((a, p) => a + (Number(p.stockBase || 0) * (Number(preferredUnit(p).cost || 0) / (Number(preferredUnit(p).factor) || 1))), 0));
  $("invWarningCount").textContent = state.products.filter(p => lowState(p).low).length;
  $("receiveProduct").innerHTML = '<option value="">Chọn sản phẩm</option>' + state.products.map(p => `<option value="${p.id}">${esc(p.name)} · ${esc(p.barcode || '')}</option>`).join("");
  if (state.receiveProductId) { $("receiveProduct").value = state.receiveProductId; renderReceiveUnits(); }
}
$("inventorySearch")?.addEventListener("input", renderInventory);
$("inventoryTable")?.addEventListener("click", e => {
  const ed = e.target.closest("[data-edit]");
  if (!ed) return;
  const product = findProductById(ed.dataset.edit);
  if (product) openProductModal(product);
});
$("receiveProduct")?.addEventListener("change", e => selectReceiveProduct(e.target.value));
$("receiveUnit")?.addEventListener("change", () => {
  const p = findProductById(state.receiveProductId);
  const u = unitsOf(p || {}).find(x => x.name === $("receiveUnit").value);
  if (u) $("receiveCost").value = u.cost || 0;
});
$("receiveBtn")?.addEventListener("click", async () => {
  const p = findProductById($("receiveProduct").value);
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
  $("productsTable").innerHTML = productsByCategory(ps).map(group => `
    <tr class="category-section"><td colspan="8">${esc(group.category)} <span>${group.products.length} mặt hàng</span></td></tr>
    ${group.products.map(p => {
      const u = preferredUnit(p);
      return `<tr>
        <td>${esc(p.barcode || "—")}</td>
        <td><b>${esc(p.name)}</b></td>
        <td>${esc(u.name)}</td>
        <td>${money(u.price)}</td>
        <td>${money(u.cost)}</td>
        <td>${Number(p.stockBase) || 0}</td>
        <td>${p.active === false ? '<span class="warning">Ngừng bán</span>' : '<span class="ok">Đang bán</span>'}</td>
        <td><button class="pencil" data-edit="${esc(p.id)}">✎</button> <button class="soft" data-print-label="${esc(p.id)}" title="In tem barcode">🖨</button> <button class="delete-btn" data-delete="${esc(p.id)}">×</button></td>
      </tr>`;
    }).join("")}
  `).join("") || '<tr><td colspan="8" class="empty-detail">Không tìm thấy mặt hàng.</td></tr>';
}
$("productsSearch")?.addEventListener("input", e => { state.productFilter = e.target.value; renderProducts(); });
$("productsTable")?.addEventListener("click", e => {
  const ed = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-delete]");
  const pl = e.target.closest("[data-print-label]");
  if (pl) {
    const p = findProductById(pl.dataset.printLabel);
    if (p) { const q = prompt(`In bao nhiêu tem cho "${p.name}"?`, "1"); if (q !== null) printBarcodeLabels({ barcode: p.barcode, name: p.name, price: preferredUnit(p).price }, q, labelCfg()); }
    return;
  }
  if (ed) openProductModal(findProductById(ed.dataset.edit));
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
    state.orderDrafts.forEach(draft => { draft.cart = draft.cart.filter(item => item.productId !== id); });
    state.cart = activeDraft()?.cart || [];
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
      <div class="full barcode-print-row">
        <label>Số tem in<input id="mPrintQty" type="number" min="1" max="500" value="1"></label>
        <label>Khổ tem<select id="mPrintSize"><option value="50x30">50 × 30 mm</option><option value="40x25">40 × 25 mm</option><option value="a4">Giấy A4 (3 cột)</option></select></label>
        <label>Nội dung tem<select id="mPrintShow"><option value="full">Tên + mã + giá</option><option value="name">Tên + mã</option><option value="code">Chỉ mã vạch</option></select></label>
        <button type="button" class="soft" id="printBarcodeBtn">🖨 In tem</button>
      </div>
      <label class="full">Tên sản phẩm<input id="mName" value="${esc(product.name || "")}" placeholder="Ví dụ: Coca-Cola 330ml"></label>
      <label>Danh mục
        <input id="mCategory" list="productCategoryList" value="${esc(product.category || "")}" placeholder="Nhập mới hoặc chọn danh mục">
        <datalist id="productCategoryList"></datalist>
      </label>
      <label>Cảnh báo tồn<input id="mLow" type="number" min="0" value="${Number(product.lowStock || 0)}"></label>
      ${slotMarkup}
      <label>Tồn cơ sở<input id="mStock" type="number" min="0" step="1" value="${Number(product.stockBase || 0)}"></label>
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
    try { window.JsBarcode("#generatedBarcode", value, { format: barcodeFormat(value), displayValue: true, height: 48, margin: 4 }); } catch (_) { preview.textContent = "Không thể tạo mã vạch. Hãy kiểm tra lại nội dung."; }
  };
  $("mBarcode").addEventListener("input", drawBarcode);
  $("generateBarcodeBtn").onclick = () => { $("mBarcode").value = createEan13(); drawBarcode(); };
  drawBarcode();
  const lc = labelCfg();
  $("mPrintSize").value = lc.size;
  $("mPrintShow").value = lc.show;
  $("printBarcodeBtn").onclick = () => {
    const slot = ($("mPref").value || "unit1").replace("unit", "");
    const price = Number($("mP" + slot)?.value ?? $("mP1")?.value) || 0;
    printBarcodeLabels({ barcode: $("mBarcode").value, name: $("mName").value.trim(), price }, $("mPrintQty").value, { size: $("mPrintSize").value, show: $("mPrintShow").value });
  };

  $("saveProductModal").onclick = async () => {
    const barcode = normalizeBarcode($("mBarcode").value);
    const name = $("mName").value.trim();
    if (!barcode || !name) { toast("Barcode và tên sản phẩm là bắt buộc.", false); return; }
    const duplicate = findProduct(barcode);
    if (duplicate && duplicate.id !== product.id) {
      toast("Barcode đã tồn tại.", false);
      return;
    }
    const stockBaseInput = Number($("mStock").value);
    if (!Number.isFinite(stockBaseInput) || stockBaseInput < 0) { toast("Tồn cơ sở phải là số không âm.", false); return; }
    const d = { barcode, name, category: $("mCategory").value.trim(), lowStock: Number($("mLow").value) || 0, stockBase: Math.floor(stockBaseInput), active: true };
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

// ----- PHẦN 10B: IN TEM BARCODE -----
const LABEL_SIZES = { "50x30": { w: 50, h: 30, name: 9, price: 11 }, "40x25": { w: 40, h: 25, name: 8, price: 10 }, a4: { w: 0, h: 34, name: 9, price: 11 } };
function hasValidBarcodeCheckDigit(code) {
  if (!/^\d+$/.test(code) || ![8, 12, 13].includes(code.length)) return false;
  const digits = code.split("").map(Number);
  const sum = digits.slice(0, -1).reduce((total, digit, index) => total + digit * ((code.length - 1 - index) % 2 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === digits[digits.length - 1];
}
function barcodeFormat(code) {
  if (code.length === 13 && hasValidBarcodeCheckDigit(code)) return "EAN13";
  if (code.length === 12 && hasValidBarcodeCheckDigit(code)) return "UPC";
  if (code.length === 8 && hasValidBarcodeCheckDigit(code)) return "EAN8";
  return "CODE128";
}
function labelCfg() {
  try {
    const c = JSON.parse(localStorage.getItem("thpos_label_cfg") || "{}");
    return { size: LABEL_SIZES[c.size] ? c.size : "50x30", show: ["full", "name", "code"].includes(c.show) ? c.show : "full" };
  } catch (_) { return { size: "50x30", show: "full" }; }
}
function printBarcodeLabels(item, qty, opts = {}) {
  const code = normalizeBarcode(item.barcode);
  if (!code) { toast("Chưa có barcode để in.", false); return; }
  if (!window.JsBarcode) { toast("Chưa tải được thư viện barcode. Hãy kiểm tra Internet.", false); return; }
  let n = Math.floor(Number(qty)) || 0;
  if (n < 1) { toast("Số tem phải lớn hơn 0.", false); return; }
  if (n > 500) { n = 500; toast("Mỗi lần in tối đa 500 tem.", false); }
  const size = LABEL_SIZES[opts.size] ? opts.size : "50x30", show = opts.show || "full", S = LABEL_SIZES[size];
  const holder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try { window.JsBarcode(holder, code, { format: barcodeFormat(code), displayValue: true, width: 2, height: 50, margin: 0, fontSize: 14 }); } catch (_) { toast("Không thể tạo mã vạch. Hãy kiểm tra nội dung mã.", false); return; }
  try { localStorage.setItem("thpos_label_cfg", JSON.stringify({ size, show })); } catch (_) { }
  const one = `<div class="l">${show !== "code" ? `<div class="n">${esc(item.name || "")}</div>` : ""}<div class="bc">${holder.outerHTML}</div>${show === "full" && Number(item.price) > 0 ? `<div class="p">${money(item.price)}</div>` : ""}</div>`;
  const page = size === "a4"
    ? "@page{size:A4;margin:8mm}.sheet{display:flex;flex-wrap:wrap}.l{width:33.333%;height:34mm;border:.2mm dashed #c4c4c4}"
    : `@page{size:${S.w}mm ${S.h}mm;margin:0}.l{width:${S.w}mm;height:${S.h}mm;page-break-after:always;break-after:page}.l:last-child{page-break-after:auto;break-after:auto}`;
  const w = window.open("", "_blank", "width=520,height=680");
  if (!w) { toast("Trình duyệt đang chặn cửa sổ in. Hãy cho phép popup.", false); return; }
  w.document.write(`<html><head><meta charset="utf-8"><title>In tem ${esc(code)}</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#000}${page}.l{padding:1.5mm 2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;break-inside:avoid}.n{font-size:${S.name}px;font-weight:700;text-align:center;line-height:1.15;max-height:2.3em;overflow:hidden;width:100%}.bc{flex:1;min-height:0;width:100%;display:flex;align-items:center;justify-content:center}.bc svg{display:block;width:auto;height:auto;max-width:100%;max-height:100%}.p{font-size:${S.price}px;font-weight:800}@media screen{body{background:#eee;padding:10px}.l{background:#fff;margin:0 0 6px}}</style></head><body><div class="sheet">${one.repeat(n)}</div></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 200);
}

// ----- PHẦN 11: CHECKOUT, QR, PRINT RECEIPT -----
async function checkout() {
  if (state.checkoutInProgress) return;
  if (!state.cart.length) { toast("Chưa có sản phẩm trong hóa đơn.", false); return; }
  const sub = state.cart.reduce((a, x) => a + x.qty * x.price, 0);
  const discount = Math.min(sub, Math.max(0, Number($("discount").value) || 0));
  const total = sub - discount;
  const isDebt = state.payment === "debt";
  const dInfo = debtInfo(total);
  if (isDebt && !dInfo.customer) { toast("Ghi nợ cần chọn khách hàng (không dùng Khách lẻ).", false); return; }
  if (isDebt && dInfo.add <= 0) { toast("Khách đã trả đủ — hãy chọn Tiền mặt hoặc Chuyển khoản.", false); return; }
  const btn = $("checkoutBtn");
  btn.disabled = true;
  btn.textContent = "ĐANG XỬ LÝ...";
  const customer = $("customerSelect")?.value || "";
  const bank = activeBank();
  const qrData = state.payment === "transfer" && bank.code && bank.number ? vietQrUrl(bank, total) : "";

  const order = {
    machineId, stateMachine: machineId,
    paymentMethod: state.payment,
    status: isDebt ? "debt" : state.payment === "transfer" ? "pending_transfer" : "paid",
    subtotal: sub, discount, total,
    customerId: customer || null,
    operatorId: auth.currentUser?.uid || null,
    operatorName: auth.currentUser?.displayName || auth.currentUser?.email || "",
    qrData: qrData,
    payRef: state.payment === "transfer" ? payRef() : "",
    customerName: dInfo.customer?.name || "",
    ...(isDebt ? { debtAmount: dInfo.add, debtPaid: 0, paidAmount: dInfo.paidNow } : {})
  };
  const checkoutDraftId = state.activeDraftId;
  const soldItems = state.cart.map(item => ({ ...item }));
  state.checkoutInProgress = true;
  let r;
  try { r = await commitSale(order, soldItems); }
  catch (error) { r = { success: false, error: error?.message || "Không thể lưu đơn hàng." }; }
  state.checkoutInProgress = false;
  btn.disabled = false;
  btn.textContent = "THANH TOÁN";
  if (!r.success) { toast(r.error, false); return; }
  toast(isDebt ? `Đã ghi nợ ${money(dInfo.add)} · ${dInfo.name}` : `Thanh toán thành công · ${money(total)}`);
  printReceipt({ ...order, id: r.id, items: soldItems });
  state.flash = { type: isDebt ? "debt" : "paid", method: state.payment, total, debt: isDebt ? { name: dInfo.name, add: dInfo.add, after: dInfo.after } : null, until: Date.now() + 6000 };
  state.qrKey = "";
  if ($("debtPaidNow")) $("debtPaidNow").value = 0;
  finishActiveOrderDraft(checkoutDraftId);
  setTimeout(renderCart, 6200);
}
$("checkoutBtn")?.addEventListener("click", checkout);

// Attach payment method button listeners with better error handling
function attachPaymentListeners() {
  const payButtons = document.querySelectorAll(".pay");
  if (payButtons.length === 0) return; // Elements might not be ready yet
  payButtons.forEach(b => b.addEventListener("click", () => {
    if (state.checkoutInProgress) return;
    document.querySelectorAll(".pay").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    const method = b.dataset.method;
    if (method) {
      state.payment = method;
      state.flash = null;
      renderCart();
      if (method === "transfer") openCustomerScreen();
    }
  }));
}

// Ensure payment listeners are attached
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachPaymentListeners);
} else {
  attachPaymentListeners();
}

function activeBank() {
  const st = state.storeSettings || {};
  const accounts = st.bankAccounts || [];
  const id = $("bankSelect")?.value || localStorage.getItem("thpos_active_bank") || accounts[0]?.id || "";
  const sel = accounts.find(x => x.id === id) || accounts[0];
  if (sel) return sel;
  const name = localStorage.getItem("thpos_bank_name") || st.bankName || "";
  return { id: "legacy", name, code: localStorage.getItem("thpos_bank_code") || st.bankCode || bankBinFromName(name), number: localStorage.getItem("thpos_bank_number") || st.bankNumber || "", owner: localStorage.getItem("thpos_bank_owner") || st.bankOwner || "" };
}
// Nội dung chuyển khoản ổn định cho mỗi lần bán (QR không đổi khi render lại, khớp với đơn đã lưu)
function payRef() { return state.payRef || (state.payRef = "TH" + Date.now().toString(36).toUpperCase().slice(-6) + Math.random().toString(36).slice(2, 4).toUpperCase()); }

function currentCustomer() { const id = $("customerSelect")?.value; return id ? state.customers.find(c => c.id === id) || null : null; }
function debtInfo(total) {
  const c = currentCustomer();
  const paidNow = Math.min(total, Math.max(0, Number($("debtPaidNow")?.value) || 0));
  const previous = Number(c?.debt) || 0;
  const add = Math.max(0, total - paidNow);
  return { customer: c, name: c?.name || "", previous, paidNow, add, after: previous + add };
}
function renderDebtBox(total) {
  const box = $("debtBox");
  if (!box) return;
  box.classList.toggle("hidden", state.payment !== "debt");
  if (state.payment !== "debt") return;
  const d = debtInfo(total);
  $("debtInfo").innerHTML = d.customer
    ? `<div><span>Khách hàng</span><b>${esc(d.name)}</b></div><div><span>Nợ cũ</span><b>${money(d.previous)}</b></div><div><span>Ghi nợ đơn này</span><b class="danger">${money(d.add)}</b></div><div><span>Tổng nợ sau đơn</span><b>${money(d.after)}</b></div>`
    : '<div class="debt-warn">Chọn khách hàng (hoặc bấm ＋ Khách) để ghi nợ. Khách lẻ không thể ghi nợ.</div>';
}

function renderQR(total) {
  const box = $("bankBox");
  if (!box) return;
  box.classList.toggle("hidden", state.payment !== "transfer");
  if (state.payment !== "transfer") return;
  const bank = activeBank();
  const qr = $("qr");
  const qrKey = `${bank.id}|${bank.code}|${bank.number}|${Math.round(Number(total) || 0)}|${payRef()}`;
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
  $("qrText").textContent = bank.code && bank.number ? `${bank.name} · ${bank.number} · ${bank.owner} · Nội dung: ${payRef()}` : "Hãy lưu tài khoản nhận trong Cài đặt";
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

function vietQrUrl(bank, total, template = "compact2") {
  const amount = Math.max(0, Math.round(Number(total) || 0));
  return `https://img.vietqr.io/image/${encodeURIComponent(bank.code)}-${encodeURIComponent(bank.number)}-${template}.png?amount=${amount}&addInfo=${encodeURIComponent(payRef())}&accountName=${encodeURIComponent(bank.owner || "")}`;
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
  w.document.write(`<html><head><title>Hóa đơn ${esc(order.id)}</title><style>@page{size:80mm auto;margin:0}*{box-sizing:border-box}html{width:100%;display:flex;justify-content:center}body{font-family:Arial,sans-serif;width:72mm;margin:0 auto;padding:4mm 0;color:#172033;font-size:11px}.brand{text-align:center;border-bottom:1px solid #172033;padding-bottom:8px;margin-bottom:8px}.brand h2{margin:0 0 3px;font-size:21px;letter-spacing:.3px;text-transform:uppercase}.brand p{margin:2px 0;font-size:9px;color:#414b5c}.legal{font-size:10px;font-weight:700}.meta{font-size:9px;line-height:1.5;margin-bottom:6px}.meta b{font-size:10px}table{width:100%;border-collapse:collapse;table-layout:fixed}th{font-size:9px;text-align:left;border-bottom:1px solid #172033;padding:5px 0}th:nth-child(1){width:48%}th:nth-child(2){width:16%;text-align:center}th:nth-child(3){width:36%;text-align:right}td{padding:6px 0;border-bottom:1px dashed #b9c1ce;vertical-align:top;word-wrap:break-word}td:nth-child(2){text-align:center}.r{text-align:right}.subline{font-size:9px;color:#596579;margin-top:2px}.sum{display:flex;justify-content:space-between;margin-top:7px}.t{font-size:17px;font-weight:800;border-top:1px solid #172033;padding-top:8px;margin:9px 0 0}.thanks{text-align:center;border-top:1px dashed #aab3c1;margin-top:12px;padding-top:9px;font-size:10px;color:#596579}@media print{html,body{width:80mm;margin:0 auto}body{padding:3mm 4mm}}</style></head><body><div class="brand"><h2>${esc(store.storeName || store.businessName || "TẠP HÓA POS")}</h2>${store.businessName ? `<p class="legal">HKD: ${esc(store.businessName)}</p>` : ""}${store.businessAddress ? `<p>${esc(store.businessAddress)}</p>` : ""}${store.businessPhone ? `<p>ĐT: ${esc(store.businessPhone)}</p>` : ""}${store.taxCode ? `<p>MST: ${esc(store.taxCode)}</p>` : ""}${store.businessSlogan ? `<p>${esc(store.businessSlogan)}</p>` : ""}</div><div class="meta"><b>HÓA ĐƠN BÁN HÀNG</b><br>Mã HĐ: ${esc(order.id)}<br>Thời gian: ${new Date().toLocaleString('vi-VN')}<br>Máy: ${esc(machineId)}${order.customerName ? '<br>Khách: ' + esc(order.customerName) : ''}</div><table><thead><tr><th>Mặt hàng</th><th>SL</th><th>Thành tiền</th></tr></thead><tbody>${order.items.map(i => `<tr><td>${esc(i.name)}<div class="subline">${esc(i.unit)} x ${money(i.price)}</div></td><td>${i.qty}</td><td class="r">${money(i.qty * i.price)}</td></tr>`).join("")}</tbody></table><div class="sum"><span>Tạm tính</span><b>${money(order.subtotal)}</b></div><div class="sum"><span>Giảm giá</span><b>${money(order.discount)}</b></div><p class="t">TỔNG: ${money(order.total)}</p><div class="sum"><span>Thanh toán</span><b>${payLabel(order)}</b></div>${order.debtAmount ? `<div class="sum"><span>Khách trả trước</span><b>${money(order.paidAmount || 0)}</b></div><div class="sum"><span>Ghi nợ</span><b>${money(order.debtAmount)}</b></div>` : ""}<div class="thanks">${esc(store.businessSlogan || "Cảm ơn quý khách và hẹn gặp lại!")}</div></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

// ----- PHẦN 12: CUSTOMER SCREEN -----
function customerPayload(total) {
  const st = state.storeSettings || {}, bank = activeBank(), d = debtInfo(total);
  const transfer = state.payment === "transfer" && bank.code && bank.number && total > 0;
  const f = state.flash && state.flash.until > Date.now() ? state.flash : null;
  return {
    ts: Date.now(),
    customer: $("customerSelect")?.selectedOptions?.[0]?.text || "Khách lẻ",
    items: state.cart, total,
    subtotal: state.cart.reduce((sum, item) => sum + item.qty * item.price, 0),
    discount: Math.max(0, Number($("discount")?.value) || 0),
    paymentMethod: state.payment,
    qrData: transfer ? vietQrUrl(bank, total, "qr_only") : "",
    qrFull: transfer ? vietQrUrl(bank, total) : "",
    payRef: transfer ? payRef() : "",
    bankName: bank.name, bankOwner: bank.owner, bankNumber: bank.number,
    debt: state.payment === "debt" && d.customer ? { name: d.name, previous: d.previous, paidNow: d.paidNow, add: d.add, after: d.after } : null,
    flash: f,
    store: { storeName: st.storeName, businessName: st.businessName, taxCode: st.taxCode, businessAddress: st.businessAddress, businessPhone: st.businessPhone, businessSlogan: st.businessSlogan }
  };
}
const screenChannel = "BroadcastChannel" in window ? new BroadcastChannel("thpos_customer_screen") : null;
let lastScreen = null;
function pushCustomerScreen(data = lastScreen) {
  if (!data) return;
  lastScreen = data;
  try { localStorage.setItem("thpos_customer_screen", JSON.stringify(data)); } catch (_) { }
  try { screenChannel?.postMessage({ type: "pos-update", data }); } catch (_) { }
  try { window.customerScreen?.postMessage({ type: "pos-update", data }, "*"); } catch (_) { }
}
function updateCustomerScreen(total) { pushCustomerScreen(customerPayload(total)); }
screenChannel?.addEventListener("message", e => { if (e.data?.type === "customer-ready") pushCustomerScreen(); });
window.addEventListener("message", e => { if (e.data?.type === "customer-ready") pushCustomerScreen(); });
setInterval(() => { if (lastScreen) pushCustomerScreen({ ...lastScreen, ts: Date.now() }); }, 4000);
$("customerScreenBtn")?.addEventListener("click", openCustomerScreen);
$("customerScreenTop")?.addEventListener("click", openCustomerScreen);
function openCustomerScreen() {
  if (window.customerScreen && !window.customerScreen.closed) {
    window.customerScreen.focus();
    pushCustomerScreen();
    return window.customerScreen;
  }
  const screen = window.open("customer-screen.html", "THPOS_CUSTOMER", "popup,width=1280,height=900");
  if (!screen) { toast("Hãy cho phép cửa sổ màn hình khách để hiển thị mã QR.", false); return null; }
  window.customerScreen = screen;
  screen.focus();
  pushCustomerScreen();
  return screen;
}

// ----- PHẦN 13: DASHBOARD (LEGACY) -----
function renderDashboard() {
  const paid = state.orders.filter(o => isSale(o) && inPeriod(o, state.dashboardPeriod || "day"));
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
      <td>${esc(customerLabel(o))}</td>
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
  $("customerList").innerHTML = sortedCustomers(state.customers).filter(c => !q || String(c.name || "").toLowerCase().includes(q) || String(c.phone || "").includes(q)).map(c => `
    <div class="customer-row ${state.selectedCustomer === c.id ? "active" : ""}" data-cust-open="${c.id}">
      <div><b>${esc(c.name || "Không tên")}</b><small>${esc(c.phone || "")}</small></div>
      <div class="cust-right">${Number(c.debt) > 0 ? `<span class="debt-pill">Nợ ${money(c.debt)}</span>` : ""}<button class="soft" data-cust-edit="${c.id}">Sửa</button> <button class="danger" data-cust-del="${c.id}">Xóa</button></div>
    </div>
  `).join("") || '<div class="empty-detail">Chưa có khách hàng.</div>';
}
function renderCustomerDetail() {
  const box = $("customerDetail");
  if (!box) return;
  const c = state.customers.find(x => x.id === state.selectedCustomer);
  if (!c) { box.innerHTML = '<div class="empty-detail">Chọn một khách hàng để xem lịch sử mua hàng và công nợ.</div>'; return; }
  const os = state.orders.filter(o => o.customerId === c.id && o.status !== "cancelled");
  const spent = os.reduce((a, o) => a + Number(o.total || 0), 0);
  const debt = Number(c.debt) || 0;
  box.innerHTML = `<div class="customer-detail-head"><div><h2>${esc(c.name)}</h2><p>${esc(c.phone || "Chưa có SĐT")} · ${os.length} đơn</p></div>${debt > 0 ? `<button class="primary" data-collect="${c.id}">Thu nợ</button>` : ""}</div>
    <div class="debt-summary"><div><span>Công nợ hiện tại</span><b class="${debt > 0 ? "danger" : ""}">${money(debt)}</b></div><div><span>Tổng đã mua</span><b>${money(spent)}</b></div></div>
    <div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Tổng</th><th>Thanh toán</th><th>Tình trạng</th></tr></thead><tbody>${os.slice(0, 30).map(o => `<tr><td>${dateValue(o.createdAt)?.toLocaleString("vi-VN") || ""}</td><td>${money(o.total)}</td><td>${esc(payLabel(o))}</td><td>${esc(statusLabel(o))}</td></tr>`).join("") || '<tr><td colspan="4">Chưa có đơn.</td></tr>'}</tbody></table></div>`;
}
$("customerDetail")?.addEventListener("click", e => { const b = e.target.closest("[data-collect]"); if (b) openCollectDebt(b.dataset.collect); });
function openCollectDebt(id) {
  const c = state.customers.find(x => x.id === id);
  if (!c) return;
  const debt = Number(c.debt) || 0;
  $("modalTitle").textContent = "Thu nợ · " + (c.name || "");
  $("modalBody").innerHTML = `<div class="form-grid"><label class="full">Công nợ hiện tại<input value="${money(debt)}" disabled></label><label>Số tiền thu<input id="debtAmt" type="number" min="1" max="${debt}" value="${debt}"></label><label>Hình thức<select id="debtMethod"><option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option></select></label><label class="full">Ghi chú<input id="debtNote" placeholder="Ví dụ: khách trả đợt 1"></label></div><div class="form-actions"><button class="soft" id="debtCancel">Hủy</button><button class="primary" id="debtSave">Xác nhận thu</button></div>`;
  $("modal").classList.remove("hidden");
  $("debtCancel").onclick = () => $("modal").classList.add("hidden");
  $("debtSave").onclick = async () => {
    const amount = Math.round(Number($("debtAmt").value) || 0);
    if (amount <= 0 || amount > debt) { toast("Số tiền thu không hợp lệ.", false); return; }
    const ids = state.orders.filter(o => o.customerId === id && o.status === "debt").sort((x, y) => (dateValue(x.createdAt) || 0) - (dateValue(y.createdAt) || 0)).map(o => o.id).slice(0, 100);
    const btn = $("debtSave");
    btn.disabled = true;
    const r = await collectDebt(id, amount, $("debtMethod").value, $("debtNote").value.trim(), ids);
    btn.disabled = false;
    if (!r.success) { toast(r.error, false); return; }
    $("modal").classList.add("hidden");
    toast(`Đã thu nợ ${money(amount)}`);
  };
}
$("customerPageSearch")?.addEventListener("input", debounce(renderCustomers));
$("customerList")?.addEventListener("click", async e => {
  const ed = e.target.closest('[data-cust-edit]');
  const dl = e.target.closest('[data-cust-del]');
  const op = e.target.closest('[data-cust-open]');
  if (op && !ed && !dl) { state.selectedCustomer = op.dataset.custOpen; renderCustomers(); renderCustomerDetail(); return; }
  if (ed) {
    const c = state.customers.find(x => x.id === ed.dataset.custEdit);
    if (!c) return;
    const name = prompt('Tên khách hàng:', c.name || '');
    if (!name) return;
    const phone = prompt('Số điện thoại:', c.phone || '') || '';
    const r = await updateCustomer(c.id, { name, phone });
    toast(r.success ? 'Đã cập nhật khách hàng' : r.error, !r.success ? false : true);
  }
  if (dl && confirm((Number(state.customers.find(x => x.id === dl.dataset.custDel)?.debt) || 0) > 0 ? 'Khách này còn công nợ. Xóa sẽ mất sổ nợ của khách. Vẫn xóa?' : 'Xóa khách hàng này?')) {
    const r = await deleteCustomer(dl.dataset.custDel);
    toast(r.success ? 'Đã xóa khách hàng' : r.error, !r.success ? false : true);
  }
});
$("addCustomerBtn")?.addEventListener("click", () => promptCustomer(true));
$("addCustomerPageBtn")?.addEventListener("click", () => promptCustomer());
function sortedCustomers(customers) {
  return customers.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "vi", { sensitivity: "base" }));
}

async function promptCustomer(selectForOrder = false) {
  const name = prompt("Tên khách hàng:");
  if (!name) return;
  const phone = prompt("Số điện thoại:") || "";
  const r = await addCustomer({ name, phone });
  if (!r.success) { toast(r.error, false); return; }
  if (r.id && !state.customers.some(customer => customer.id === r.id)) state.customers.push({ id: r.id, name, phone });
  if (selectForOrder) {
    renderCustomerSelect();
    if (r.id && $("customerSelect")) $("customerSelect").value = r.id;
    renderCart();
  }
  toast(selectForOrder ? "Đã thêm khách hàng vào đơn" : "Đã thêm khách hàng");
}

function renderCustomerSelect() {
  const s = $("customerSelect");
  if (!s) return;
  const keep = s.value;
  s.innerHTML = '<option value="">Khách lẻ</option>' + sortedCustomers(state.customers).map(c => `<option value="${esc(c.id)}">${esc(c.name || "Không tên")}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`).join("");
  s.value = state.customers.some(c => c.id === keep) ? keep : "";
}

function openCustomerPicker() {
  const selectedId = $("customerSelect")?.value || "";
  const renderMatches = () => {
    const q = ($("customerPickerSearch")?.value || "").trim().toLocaleLowerCase("vi");
    const customers = sortedCustomers(state.customers).filter(customer =>
      !q || `${customer.name || ""} ${customer.phone || ""}`.toLocaleLowerCase("vi").includes(q)
    );
    $("customerPickerList").innerHTML = `
      <button type="button" class="customer-picker-option ${selectedId ? "" : "active"}" data-pick-customer="">
        <span><b>Khách lẻ</b><small>Không gắn khách hàng vào đơn</small></span>${selectedId ? "" : "<strong>Đang chọn</strong>"}
      </button>
      ${customers.length ? customers.map(customer => `
        <button type="button" class="customer-picker-option ${customer.id === selectedId ? "active" : ""}" data-pick-customer="${esc(customer.id)}">
          <span><b>${esc(customer.name || "Không tên")}</b><small>${esc(customer.phone || "Không có số điện thoại")}</small></span>${customer.id === selectedId ? "<strong>Đang chọn</strong>" : ""}
        </button>
      `).join("") : `<div class="empty-detail">${q ? "Không tìm thấy khách hàng." : "Chưa có khách hàng."}</div>`}
    `;
  };
  $("modalTitle").textContent = "Chọn khách hàng cho đơn";
  $("modalBody").innerHTML = `
    <label class="customer-picker-search">Tìm theo tên hoặc số điện thoại
      <input id="customerPickerSearch" type="search" placeholder="Nhập tên hoặc số điện thoại...">
    </label>
    <div id="customerPickerList" class="customer-picker-list"></div>
  `;
  $("modal").classList.remove("hidden");
  $("customerPickerSearch").addEventListener("input", renderMatches);
  $("customerPickerList").addEventListener("click", event => {
    const option = event.target.closest("[data-pick-customer]");
    if (!option) return;
    if ($("customerSelect")) $("customerSelect").value = option.dataset.pickCustomer;
    $("modal").classList.add("hidden");
    renderCart();
  });
  renderMatches();
  requestAnimationFrame(() => $("customerPickerSearch")?.focus());
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
  const vals = days.map(d => state.orders.filter(o => isSale(o) && ((dateValue(o.createdAt) || new Date()).toDateString() === d.toDateString())).reduce((a, o) => a + Number(o.total || 0), 0));
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
  const paid = state.orders.filter(o => isSale(o));
  const best = topProducts(paid);
  if ($("topProducts")) $("topProducts").innerHTML = best.map((x, i) => `<div class="low-item"><span>${i + 1}. ${esc(x.name)}</span><b>${x.qty}</b></div>`).join('') || '<div class="low-item">Chưa có dữ liệu.</div>';
}

function renderReportsV53() {
  const period = $("reportPeriod")?.value || 'day';
  const orders = state.orders.filter(o => isSale(o) && inPeriod(o, period));
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
    <div class="report-row"><span>Bán chịu trong kỳ</span><b>${money(orders.reduce((a, o) => a + (Number(o.debtAmount) || 0), 0))}</b></div>
    <div class="report-row"><span>Công nợ phải thu (tất cả khách)</span><b>${money(state.customers.reduce((a, c) => a + (Number(c.debt) || 0), 0))}</b></div>
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

function renderSettingsV53(cfgIn) {
  (cfgIn ? Promise.resolve(cfgIn) : getSettings()).then(cfg => {
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
    renderCart();
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
const PRODUCT_EXPORT_COLUMNS = [
  ["barcode", "Mã vạch"], ["name", "Tên sản phẩm"], ["category", "Danh mục"], ["preferredUnit", "Đơn vị ưu tiên"],
  ["unit1", "Đơn vị 1"], ["unit1Factor", "Hệ số quy đổi 1"], ["unit1Cost", "Giá vốn đơn vị 1"], ["unit1Price", "Giá bán đơn vị 1"],
  ["unit2", "Đơn vị 2"], ["unit2Factor", "Hệ số quy đổi 2"], ["unit2Cost", "Giá vốn đơn vị 2"], ["unit2Price", "Giá bán đơn vị 2"],
  ["unit3", "Đơn vị 3"], ["unit3Factor", "Hệ số quy đổi 3"], ["unit3Cost", "Giá vốn đơn vị 3"], ["unit3Price", "Giá bán đơn vị 3"],
  ["stockBase", "Tồn kho (đơn vị cơ sở)"], ["lowStock", "Ngưỡng cảnh báo tồn"]
];

const IMPORT_HEADER_ALIASES = {};
const PRODUCT_IMPORT_ALIASES = {
  barcode: ["Mã vạch", "barcode", "mã hàng"], name: ["Tên sản phẩm", "name", "tên hàng"], category: ["Danh mục", "category"],
  preferredUnit: ["Đơn vị ưu tiên", "preferredUnit"], unit1: ["Đơn vị 1", "unit1"], unit1Factor: ["Hệ số quy đổi 1", "Hệ số đơn vị 1", "Hệ số 1", "unit1Factor"],
  unit1Cost: ["Giá vốn đơn vị 1", "Giá vốn 1", "unit1Cost"], unit1Price: ["Giá bán đơn vị 1", "Giá bán 1", "unit1Price"],
  unit2: ["Đơn vị 2", "unit2"], unit2Factor: ["Hệ số quy đổi 2", "Hệ số đơn vị 2", "Hệ số 2", "unit2Factor"],
  unit2Cost: ["Giá vốn đơn vị 2", "Giá vốn 2", "unit2Cost"], unit2Price: ["Giá bán đơn vị 2", "Giá bán 2", "unit2Price"],
  unit3: ["Đơn vị 3", "unit3"], unit3Factor: ["Hệ số quy đổi 3", "Hệ số đơn vị 3", "Hệ số 3", "unit3Factor"],
  unit3Cost: ["Giá vốn đơn vị 3", "Giá vốn 3", "unit3Cost"], unit3Price: ["Giá bán đơn vị 3", "Giá bán 3", "unit3Price"],
  stockBase: ["Tồn kho", "Tồn kho cơ sở", "Tồn kho (đơn vị cơ sở)", "stockBase"], lowStock: ["Ngưỡng cảnh báo tồn", "Cảnh báo tồn", "lowStock"]
};
function normalizeExcelHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
for (const [field, aliases] of Object.entries(PRODUCT_IMPORT_ALIASES)) {
  for (const alias of [field, ...aliases]) IMPORT_HEADER_ALIASES[normalizeExcelHeader(alias)] = field;
}
function mapImportedProductRow(row) {
  const mapped = {};
  for (const [header, value] of Object.entries(row)) {
    const field = IMPORT_HEADER_ALIASES[normalizeExcelHeader(header)];
    if (field) mapped[field] = value;
  }
  return mapped;
}
function addLocalizedSheet(workbook, rows, columns, sheetName) {
  const data = [columns.map(([, label]) => label), ...rows.map(row => columns.map(([field]) => row[field] ?? ""))];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = columns.map(([, label]) => ({ wch: Math.max(14, Math.min(30, label.length + 3)) }));
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
}

$("downloadTemplate")?.addEventListener('click', () => {
  const wb = XLSX.utils.book_new();
  addLocalizedSheet(wb, [], PRODUCT_EXPORT_COLUMNS, 'Hàng hóa');
  XLSX.writeFile(wb, 'Mau_nhap_hang_Tap_Hoa_POS.xlsx');
});

let importRows = [];
$("excelFile")?.addEventListener('change', async e => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const data = await f.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    importRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).map(mapImportedProductRow);
    const columns = PRODUCT_EXPORT_COLUMNS.filter(([field]) => importRows.some(row => field in row));
    const previewRows = importRows.slice(0, 8);
    $("importPreview").innerHTML = `<p class="muted">Đã đọc ${importRows.length} dòng. Hiển thị tối đa 8 dòng đầu tiên để kiểm tra.</p>${columns.length ? `<div class="table-wrap import-preview-table"><table><thead><tr>${columns.map(([, label]) => `<th>${esc(label)}</th>`).join("")}</tr></thead><tbody>${previewRows.map(row => `<tr>${columns.map(([field]) => `<td>${esc(row[field] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : '<p class="import-error">Không tìm thấy tiêu đề cột phù hợp. Hãy tải tệp mẫu để xem đúng định dạng.</p>'}`;
    $("confirmImport").classList.toggle('hidden', !importRows.length || !columns.length);
  } catch (error) {
    importRows = [];
    $("importPreview").innerHTML = '<p class="import-error">Không đọc được tệp. Hãy chọn tệp Excel hoặc CSV hợp lệ.</p>';
    $("confirmImport").classList.add('hidden');
    console.error("Excel import error", error);
  }
});
$("confirmImport")?.addEventListener('click', async () => {
  let ok = 0, skipped = 0, failed = 0;
  for (const row of importRows) {
    if (!row.name || !row.barcode) { skipped++; continue; }
    const d = { ...row, barcode: normalizeBarcode(row.barcode), name: String(row.name).trim(), stockBase: Number(row.stockBase) || 0, lowStock: Number(row.lowStock) || 0 };
    for (let i = 1; i <= 3; i++) { d['unit' + i] = String(d['unit' + i] || '').trim(); d['unit' + i + 'Factor'] = Number(d['unit' + i + 'Factor']) || 1; d['unit' + i + 'Cost'] = Number(d['unit' + i + 'Cost']) || 0; d['unit' + i + 'Price'] = Number(d['unit' + i + 'Price']) || 0; }
    d.preferredUnit = d.preferredUnit || d.unit1;
    const old = findProduct(d.barcode);
    const r = old ? await updateProduct(old.id, d) : await addProduct(d);
    if (r.success) ok++; else failed++;
  }
  toast(`Đã nhập ${ok} sản phẩm · bỏ qua ${skipped} dòng thiếu mã vạch hoặc tên · lỗi ${failed} dòng`, failed ? false : true);
});
$("exportExcel")?.addEventListener('click', () => {
  const wb = XLSX.utils.book_new();
  addLocalizedSheet(wb, state.products, PRODUCT_EXPORT_COLUMNS, 'Hàng hóa');
  XLSX.writeFile(wb, 'Danh_sach_hang_hoa_Tap_Hoa_POS.xlsx');
});
$("exportOrdersBtn")?.addEventListener('click', () => {
  const columns = [["id", "Mã đơn"], ["createdAt", "Thời gian"], ["customer", "Khách hàng"], ["quantity", "Tổng số lượng"], ["subtotal", "Tạm tính"], ["discount", "Giảm giá"], ["total", "Tổng thanh toán"], ["payment", "Phương thức thanh toán"], ["status", "Trạng thái"], ["machine", "Mã quầy"], ["operator", "Nhân viên"]];
  const rows = state.orders.map(order => ({
    id: order.id,
    createdAt: dateValue(order.createdAt)?.toLocaleString("vi-VN") || "",
    customer: customerLabel(order),
    quantity: (order.items || []).reduce((total, item) => total + Number(item.qty || 0), 0),
    subtotal: Number(order.subtotal) || 0,
    discount: Number(order.discount) || 0,
    total: Number(order.total) || 0,
    payment: payLabel(order),
    status: statusLabel(order),
    machine: order.machineId || "",
    operator: order.operatorName || ""
  }));
  const wb = XLSX.utils.book_new();
  addLocalizedSheet(wb, rows, columns, 'Đơn hàng');
  XLSX.writeFile(wb, 'Danh_sach_don_hang_Tap_Hoa_POS.xlsx');
});
$("exportExpensesBtn")?.addEventListener('click', () => {
  const columns = [["date", "Ngày"], ["category", "Danh mục chi phí"], ["amount", "Số tiền"], ["note", "Ghi chú"]];
  const wb = XLSX.utils.book_new();
  addLocalizedSheet(wb, state.expenses, columns, 'Chi phí');
  XLSX.writeFile(wb, 'Danh_sach_chi_phi_Tap_Hoa_POS.xlsx');
});

// ----- PHẦN 21: ORDER CONTROLS (print/cancel) -----
function renderOrdersV53() {
  const q = ($('orderSearch')?.value || '').toLowerCase();
  $('orderTable').innerHTML = state.orders.filter(o => !q || String(o.id).toLowerCase().includes(q) || String(o.customerId || '').toLowerCase().includes(q)).map(o => `
    <tr>
      <td>${esc(o.id)}</td>
      <td>${dateValue(o.createdAt)?.toLocaleString('vi-VN') || ''}</td>
      <td>${esc(customerLabel(o))}</td>
      <td>${(o.items || []).reduce((a, i) => a + Number(i.qty || 0), 0)}</td>
      <td>${money(o.total)}</td>
      <td>${money(Number(o.total || 0) - (o.items || []).reduce((a, i) => a + Number(i.cost || 0) * Number(i.qty || 0), 0))}</td>
      <td>${esc(payLabel(o))}<br><small>${esc(statusLabel(o))}</small></td>
      <td>${o.status === 'cancelled' ? '' : `<button class="soft" data-print-order="${o.id}">In</button> ${o.status === 'pending_transfer' ? `<button class="primary" data-confirm-order="${o.id}">✓ Đã nhận tiền</button> ` : ''}<button class="danger" data-cancel-order="${o.id}">Hủy + hoàn kho</button>`}</td>
    </tr>
  `).join('');
}
$("orderTable")?.addEventListener('click', async e => {
  const pr = e.target.closest('[data-print-order]');
  if (pr) { const o = state.orders.find(x => x.id === pr.dataset.printOrder); if (o) printReceipt(o); }
  const cf = e.target.closest('[data-confirm-order]');
  if (cf) { const r = await confirmTransfer(cf.dataset.confirmOrder); toast(r.success ? 'Đã xác nhận nhận tiền' : r.error, r.success); }
  const ca = e.target.closest('[data-cancel-order]');
  if (ca && confirm('Hủy đơn và hoàn lại tồn kho?')) {
    const r = await cancelOrder(ca.dataset.cancelOrder);
    toast(r.success ? 'Đã hủy đơn và hoàn kho' : r.error, !r.success ? false : true);
  }
});
$("markNotificationsRead")?.addEventListener('click', () => toast('Đã đánh dấu thông báo đã xem'));

// ----- PHẦN 22: EXTRA CONTROLS (find customer, receive quick, open QR, change password, backup, reset demo) -----
function bindExtraControls() {
  $("findCustomerBtn")?.addEventListener("click", openCustomerPicker);
  $("receiveQuickBtn")?.addEventListener("click", () => { setPage("inventory"); setTimeout(() => $("receiveBarcodeInput")?.focus(), 50); });
  $("openQrBtn")?.addEventListener("click", () => {
    const bank = $("qrText")?.textContent || "";
    const q = $("qr")?.innerHTML || "";
    if (!q) { toast("Chưa có QR để mở.", false); return; }
    const w = window.open("", "THPOS_QR", "width=520,height=620");
    if (w) { w.document.write(`<html><head><title>QR thanh toán</title></head><body style="font-family:Arial;text-align:center;padding:30px"><h2>QR thanh toán</h2><div>${q}</div><p>${esc(bank)}</p></body></html>`); w.document.close(); }
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
  $("clearCart")?.addEventListener("click", clearActiveOrder);
  
  // Bind extra controls
  bindExtraControls();
}
bindNav();

async function doLogout() { await logoutUser(); location.href = "index.html"; }

function startListeners() {
  onSyncStatus(s => { state.sync = { ...state.sync, ...s }; if (s.ok && s.fromCache === false) state.sync.last = Date.now(); paintSync(); });
  loadCachedProducts();
  function applyProducts(ps) {
    setProducts(ps);
    state.orderDrafts.forEach(draft => {
      draft.cart = draft.cart.filter(item => state.productById.has(item.productId));
      draft.cart.forEach(x => {
        const p = findProductById(x.productId);
        const u = p && unitsOf(p).find(unit => unit.name === x.unit);
        if (u) { x.price = u.price; x.cost = u.cost; x.name = p.name; }
      });
    });
    state.cart = activeDraft()?.cart || [];
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
  listenOrders(os => { state.orders = os; if (state.page === "orders") renderOrdersV53(); if (state.page === "dashboard") renderDashboardV53(); if (state.page === "reports") renderReportsV53(); if (state.page === "customers") renderCustomerDetail(); });
  listenCustomers(cs => { state.customers = cs; renderCustomerSelect(); renderCart(); if (state.page === "customers") { renderCustomers(); renderCustomerDetail(); } if (state.page === "reports") renderReportsV53(); });
  listenSuppliers(x => { state.suppliers = x; if (state.page === "suppliers") renderSuppliers(); });
  listenExpenses(x => { state.expenses = x; if (state.page === "expenses") renderExpenses(); if (state.page === "reports") renderReportsV53(); });
  listenSettings(cfg => {
    if (state.page === "settings" && document.activeElement?.matches?.("#page-settings input, #page-settings select")) return;
    renderSettingsV53(cfg);
  });
  window.addEventListener("online", paintSync);
  window.addEventListener("offline", paintSync);
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (state.page === "dashboard") renderDashboardV53();
    if (state.page === "reports") renderReportsV53();
    paintSync();
  }, 60000);
  paintSync();
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
