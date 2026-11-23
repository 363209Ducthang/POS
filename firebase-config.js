// =============================================
// TẠP HÓA POS – Firebase Config & Database Helpers
// =============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  onSnapshot,
  addDoc,
  serverTimestamp,
  runTransaction,
  orderBy,
  limit,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ---- CẤU HÌNH ----
const firebaseConfig = {
  apiKey: "AIzaSyCQqF3uE7AkM6JJORSE6WEsz8vaASjs8KA",
  authDomain: "pos-sale-7b97d.firebaseapp.com",
  projectId: "pos-sale-7b97d",
  storageBucket: "pos-sale-7b97d.firebasestorage.app",
  messagingSenderId: "956872121564",
  appId: "1:956872121564:web:adae0ace428374cc652819",
  measurementId: "G-MBYPCRHS4F"
};

// ---- KHỞI TẠO ----
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
const facebookProvider = new FacebookAuthProvider();

function getCurrentUserUid() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.");
  return uid;
}

function userCollection(uid, name) {
  return collection(db, "users", uid, name);
}

function userDoc(uid, name, id) {
  return doc(db, "users", uid, name, id);
}

function userSettingsDoc(uid) {
  return doc(db, "users", uid, "settings", "store");
}

// ---- AUTH ----
export async function loginWithEmail(email, password) {
  try {
    const c = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: c.user };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function registerWithEmail(email, password, displayName) {
  try {
    const c = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) await updateProfile(c.user, { displayName });
    await setDoc(doc(db, "users", c.user.uid), {
      name: displayName || email.split("@")[0],
      email,
      role: "staff",
      createdAt: serverTimestamp()
    }, { merge: true });
    return { success: true, user: c.user };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function loginWithGoogle() {
  try {
    const r = await signInWithPopup(auth, googleProvider);
    await ensureUser(r.user);
    return { success: true, user: r.user };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function loginWithFacebook() {
  try {
    const r = await signInWithPopup(auth, facebookProvider);
    await ensureUser(r.user);
    return { success: true, user: r.user };
  } catch (e) { return { success: false, error: e.message }; }
}

async function ensureUser(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: user.displayName || user.email?.split("@")[0] || "Nhân viên",
      email: user.email || "",
      role: "staff",
      createdAt: serverTimestamp()
    });
  }
}

export async function logoutUser() {
  try { await signOut(auth); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
}

export async function resetPassword(email) {
  try { await sendPasswordResetEmail(auth, email); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
}

export function getCurrentUser() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
  });
}

export function onAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

// ---- PRODUCTS ----
export async function getProducts() {
  const uid = getCurrentUserUid();
  const s = await getDocs(userCollection(uid, "products"));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addProduct(data) {
  try {
    const uid = getCurrentUserUid();
    const r = await addDoc(userCollection(uid, "products"), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return { success: true, id: r.id };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function updateProduct(id, data) {
  try {
    const uid = getCurrentUserUid();
    await updateDoc(userDoc(uid, "products", id), { ...data, updatedAt: serverTimestamp() });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function deleteProductFirebase(id) {
  try {
    const uid = getCurrentUserUid();
    await deleteDoc(userDoc(uid, "products", id));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

export function listenProducts(callback) {
  try {
    const uid = getCurrentUserUid();
    return live(userCollection(uid, "products"), docsOf, callback);
  } catch (e) {
    return () => {};
  }
}

// ---- ORDERS ----
export async function getOrders() {
  const uid = getCurrentUserUid();
  const s = await getDocs(query(userCollection(uid, "orders"), orderBy("createdAt", "desc"), limit(500)));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveOrder(data) {
  try {
    const uid = getCurrentUserUid();
    const r = await addDoc(userCollection(uid, "orders"), { ...data, createdAt: serverTimestamp() });
    return { success: true, id: r.id };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function commitSale(orderData, items) {
  try {
    const uid = getCurrentUserUid();
    const debt = Number(orderData.debtAmount) || 0;
    if (debt > 0 && !orderData.customerId) throw new Error("Ghi nợ cần chọn khách hàng.");
    const result = await runTransaction(db, async tx => {
      const refs = items.map(i => userDoc(uid, "products", i.productId));
      const snaps = [];
      for (const ref of refs) snaps.push(await tx.get(ref));
      const custRef = debt > 0 ? userDoc(uid, "customers", orderData.customerId) : null;
      const custSnap = custRef ? await tx.get(custRef) : null;
      if (custRef && !custSnap.exists()) throw new Error("Không tìm thấy khách hàng để ghi nợ.");
      snaps.forEach((snap, idx) => {
        if (!snap.exists()) throw new Error(`Sản phẩm không tồn tại: ${items[idx].name || items[idx].productId}`);
      });
      const seen = new Set();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (seen.has(item.productId)) continue;
        seen.add(item.productId);
        const same = items.filter(x => x.productId === item.productId).reduce((a, x) => a + (Number(x.baseQty) || 0), 0);
        const stock = Number(snaps[i].data().stockBase) || 0;
        if (stock - same < 0) throw new Error(`Không đủ tồn kho: ${snaps[i].data().name || item.name}. Còn ${stock} đơn vị cơ sở.`);
      }
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (items.findIndex(x => x.productId === item.productId) !== i) continue;
        const snap = snaps[i];
        const same = items.filter(x => x.productId === item.productId).reduce((a, x) => a + (Number(x.baseQty) || 0), 0);
        tx.update(refs[i], { stockBase: (Number(snap.data().stockBase) || 0) - same, updatedAt: serverTimestamp() });
      }
      if (custRef) tx.update(custRef, { debt: (Number(custSnap.data().debt) || 0) + debt, updatedAt: serverTimestamp() });
      const orderRef = doc(userCollection(uid, "orders"));
      tx.set(orderRef, { ...orderData, items, createdAt: serverTimestamp(), stockCommitted: true });
      return orderRef.id;
    });
    return { success: true, id: result };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function cancelOrder(orderId) {
  try {
    const uid = getCurrentUserUid();
    await runTransaction(db, async tx => {
      const ref = userDoc(uid, "orders", orderId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("Không tìm thấy đơn hàng");
      const o = snap.data();
      if (o.status === "cancelled") throw new Error("Đơn đã hủy");
      if (!o.stockCommitted) throw new Error("Đơn chưa ghi nhận tồn kho");
      const items = o.items || [];
      const refs = items.map(i => userDoc(uid, "products", i.productId));
      const ps = [];
      for (const r of refs) ps.push(await tx.get(r));
      if ((Number(o.debtPaid) || 0) > 0) throw new Error("Đơn nợ đã thu một phần, không thể hủy. Hãy xử lý công nợ trước.");
      const owed = Math.max(0, (Number(o.debtAmount) || 0) - (Number(o.debtPaid) || 0));
      const cRef = owed > 0 && o.customerId ? userDoc(uid, "customers", o.customerId) : null;
      const cSnap = cRef ? await tx.get(cRef) : null;
      ps.forEach((psnap, i) => {
        if (!psnap.exists()) throw new Error("Sản phẩm đã bị xóa: " + (items[i].name || ""));
      });
      const grouped = {};
      items.forEach(i => grouped[i.productId] = (grouped[i.productId] || 0) + Number(i.baseQty || 0));
      for (const [pid, qty] of Object.entries(grouped)) {
        const idx = items.findIndex(i => i.productId === pid);
        tx.update(refs[idx], { stockBase: (Number(ps[idx].data().stockBase) || 0) + qty, updatedAt: serverTimestamp() });
      }
      if (cSnap?.exists()) tx.update(cRef, { debt: Math.max(0, (Number(cSnap.data().debt) || 0) - owed), updatedAt: serverTimestamp() });
      tx.update(ref, { status: "cancelled", cancelledAt: serverTimestamp(), stockCommitted: false });
    });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

export function listenOrders(callback) {
  try {
    const uid = getCurrentUserUid();
    return live(query(userCollection(uid, "orders"), orderBy("createdAt", "desc"), limit(500)), docsOf, callback);
  } catch (e) {
    return () => {};
  }
}

// ---- CUSTOMERS ----
export async function getCustomers() {
  try {
    const uid = getCurrentUserUid();
    const s = await getDocs(userCollection(uid, "customers"));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { return []; }
}

export async function addCustomer(data) {
  try {
    const uid = getCurrentUserUid();
    const r = await addDoc(userCollection(uid, "customers"), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return { success: true, id: r.id };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function updateCustomer(id, data) {
  try {
    const uid = getCurrentUserUid();
    await updateDoc(userDoc(uid, "customers", id), { ...data, updatedAt: serverTimestamp() });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function deleteCustomer(id) {
  try {
    const uid = getCurrentUserUid();
    await deleteDoc(userDoc(uid, "customers", id));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

export function listenCustomers(callback) {
  try {
    const uid = getCurrentUserUid();
    return live(userCollection(uid, "customers"), docsOf, callback);
  } catch (e) {
    return () => {};
  }
}

// ---- SUPPLIERS ----
export async function getSuppliers() {
  try {
    const uid = getCurrentUserUid();
    const s = await getDocs(userCollection(uid, "suppliers"));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { return []; }
}

export async function addSupplier(data) {
  try {
    const uid = getCurrentUserUid();
    const r = await addDoc(userCollection(uid, "suppliers"), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return { success: true, id: r.id };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function updateSupplier(id, data) {
  try {
    const uid = getCurrentUserUid();
    await updateDoc(userDoc(uid, "suppliers", id), { ...data, updatedAt: serverTimestamp() });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function deleteSupplier(id) {
  try {
    const uid = getCurrentUserUid();
    await deleteDoc(userDoc(uid, "suppliers", id));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

// ---- EXPENSES ----
export async function getExpenses() {
  try {
    const uid = getCurrentUserUid();
    const s = await getDocs(userCollection(uid, "expenses"));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { return []; }
}

export async function addExpense(data) {
  try {
    const uid = getCurrentUserUid();
    const r = await addDoc(userCollection(uid, "expenses"), { ...data, createdAt: serverTimestamp() });
    return { success: true, id: r.id };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function deleteExpense(id) {
  try {
    const uid = getCurrentUserUid();
    await deleteDoc(userDoc(uid, "expenses", id));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

// ---- SETTINGS ----
export async function getSettings() {
  try {
    const uid = getCurrentUserUid();
    const s = await getDoc(userSettingsDoc(uid));
    return s.exists() ? s.data() : {};
  } catch (e) { return {}; }
}

export async function saveSettings(data) {
  try {
    const uid = getCurrentUserUid();
    await setDoc(userSettingsDoc(uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

// ---- STOCK ----
export async function receiveStock(productId, baseQty, cost, unitName = "") {
  try {
    const uid = getCurrentUserUid();
    await runTransaction(db, async tx => {
      const ref = userDoc(uid, "products", productId);
      const s = await tx.get(ref);
      if (!s.exists()) throw new Error("Sản phẩm không tồn tại");
      const d = s.data();
      const patch = { stockBase: (Number(d.stockBase) || 0) + Number(baseQty), updatedAt: serverTimestamp() };
      for (let i = 1; i <= 3; i++) {
        if (String(d["unit" + i] || "") === String(unitName || "")) {
          patch["unit" + i + "Cost"] = Number(cost) || 0;
          break;
        }
      }
      tx.update(ref, patch);
    });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

// ---- EXPORT TẤT CẢ ----
export { app, auth, db };

// ---- ĐỒNG BỘ REALTIME ----
let syncHandler = () => {};
export function onSyncStatus(fn) { syncHandler = typeof fn === "function" ? fn : () => {}; }
const docsOf = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
function live(q, map, cb) {
  return onSnapshot(q, s => { syncHandler({ ok: true }); cb(map(s)); }, err => { console.error("Firestore listener:", err); syncHandler({ ok: false, error: err.message }); });
}
export function listenSuppliers(cb) { try { return live(userCollection(getCurrentUserUid(), "suppliers"), docsOf, cb); } catch (e) { return () => {}; } }
export function listenExpenses(cb) { try { return live(userCollection(getCurrentUserUid(), "expenses"), docsOf, cb); } catch (e) { return () => {}; } }
export function listenSettings(cb) {
  try {
    const uid = getCurrentUserUid();
    let prev = null;
    return onSnapshot(userSettingsDoc(uid), { includeMetadataChanges: true }, s => {
      syncHandler({ ok: true, fromCache: s.metadata.fromCache, pending: s.metadata.hasPendingWrites });
      const data = s.exists() ? s.data() : {};
      const { updatedAt, ...rest } = data;
      const sig = JSON.stringify(rest);
      if (sig === prev) return;
      prev = sig;
      cb(data);
    }, err => { console.error("Settings listener:", err); syncHandler({ ok: false, error: err.message }); });
  } catch (e) { return () => {}; }
}

// ---- CÔNG NỢ / XÁC NHẬN CHUYỂN KHOẢN ----
export async function collectDebt(customerId, amount, method = "cash", note = "", orderIds = []) {
  try {
    const uid = getCurrentUserUid();
    amount = Math.round(Number(amount) || 0);
    if (amount <= 0) throw new Error("Số tiền thu phải lớn hơn 0.");
    await runTransaction(db, async tx => {
      const cRef = userDoc(uid, "customers", customerId);
      const cSnap = await tx.get(cRef);
      if (!cSnap.exists()) throw new Error("Không tìm thấy khách hàng.");
      const debt = Number(cSnap.data().debt) || 0;
      if (amount > debt) throw new Error("Số tiền thu lớn hơn công nợ hiện tại.");
      const oSnaps = [];
      for (const id of orderIds) oSnaps.push(await tx.get(userDoc(uid, "orders", id)));
      let left = amount;
      oSnaps.forEach(s => {
        if (!s.exists() || left <= 0) return;
        const o = s.data();
        if (o.status !== "debt" || o.customerId !== customerId) return;
        const owe = Math.max(0, (Number(o.debtAmount) || 0) - (Number(o.debtPaid) || 0));
        const pay = Math.min(owe, left);
        if (pay <= 0) return;
        left -= pay;
        tx.update(s.ref, { debtPaid: (Number(o.debtPaid) || 0) + pay, status: pay >= owe ? "paid" : "debt", ...(pay >= owe ? { debtClearedAt: serverTimestamp() } : {}) });
      });
      tx.update(cRef, { debt: debt - amount, updatedAt: serverTimestamp() });
      tx.set(doc(userCollection(uid, "debtPayments")), { customerId, customerName: cSnap.data().name || "", amount, method, note, orderIds, createdAt: serverTimestamp() });
    });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

export async function confirmTransfer(orderId) {
  try {
    const uid = getCurrentUserUid();
    await runTransaction(db, async tx => {
      const ref = userDoc(uid, "orders", orderId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("Không tìm thấy đơn hàng");
      if (snap.data().status !== "pending_transfer") throw new Error("Đơn không ở trạng thái chờ chuyển khoản");
      tx.update(ref, { status: "paid", paidAt: serverTimestamp() });
    });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}
