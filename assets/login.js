// =============================================
// TẠP HÓA POS – Login Script (Firebase Compat)
// =============================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCQqF3uE7AkM6JJORSE6WEsz8vaASjs8KA",
  authDomain: "pos-sale-7b97d.firebaseapp.com",
  projectId: "pos-sale-7b97d",
  storageBucket: "pos-sale-7b97d.firebasestorage.app",
  messagingSenderId: "956872121564",
  appId: "1:956872121564:web:adae0ace428374cc652819",
  measurementId: "G-MBYPCRHS4F"
};

const $ = id => document.getElementById(id);
const msg = text => { const e = $("loginError"); if (e) e.textContent = text || ""; };
const setBusy = (busy, text = "Đăng nhập") => {
  document.querySelectorAll(".login-btn,#googleLoginBtn,#facebookLoginBtn,#demoLoginBtn").forEach(b => {
    b.disabled = busy;
    if (b.id === "demoLoginBtn") b.textContent = busy ? "Đang khởi tạo..." : "Tài khoản demo: admin / 123456";
    else if (b.classList.contains("login-btn")) b.textContent = busy ? "Đang đăng nhập..." : text;
  });
};

function friendly(error) {
  const code = String(error?.code || "").toLowerCase(), m = String(error?.message || error || "");
  if (code.includes("api-key-not-valid") || m.includes("api-key-not-valid")) return "Firebase API key không hợp lệ. Hãy cập nhật Web App config trong Firebase Console.";
  if (code.includes("operation-not-allowed")) return "Firebase chưa bật Email/Password. Vào Authentication → Sign-in method → bật Email/Password.";
  if (code.includes("invalid-email")) return "Email không hợp lệ.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Email hoặc mật khẩu không đúng.";
  if (code.includes("too-many-requests")) return "Có quá nhiều lần đăng nhập. Hãy chờ vài phút rồi thử lại.";
  if (code.includes("network-request-failed")) return "Không kết nối được Firebase. Kiểm tra Internet và mở bằng Live Server/HTTPS.";
  if (code.includes("popup-closed")) return "Cửa sổ đăng nhập Google/Facebook đã bị đóng.";
  if (code.includes("unauthorized-domain")) return "Tên miền hiện tại chưa được thêm vào Firebase Authentication → Settings → Authorized domains.";
  return m.replace(/^Firebase:\s*/i, "").replace(/\s*\(auth\/[^)]+\)\.?$/i, "").trim() || "Đăng nhập thất bại.";
}

function ensureFirebase() {
  if (!window.firebase) throw new Error("Firebase SDK chưa tải. Hãy kiểm tra Internet hoặc mở bằng Live Server/HTTPS.");
  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
  return firebase.auth();
}

async function signIn(email, password) {
  try { const user = await ensureFirebase().signInWithEmailAndPassword(email, password); return { success: true, user: user.user }; } catch (e) { return { success: false, error: e }; }
}

async function ensureUserDoc(user) {
  try {
    const db = firebase.firestore();
    const ref = db.collection("users").doc(user.uid);
    const s = await ref.get();
    if (!s.exists) {
      await ref.set({
        name: user.displayName || user.email?.split("@")[0] || "Nhân viên",
        email: user.email || "",
        role: "admin",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  } catch (e) { console.warn("Firestore permission:", e); }
}

async function demoLogin() {
  const email = "admin@pos-sale-7b97d.firebaseapp.com", password = "123456";
  setBusy(true); msg("");
  try {
    const auth = ensureFirebase();
    try {
      const c = await auth.signInWithEmailAndPassword(email, password);
      await ensureUserDoc(c.user);
      location.replace("app.html");
      return;
    } catch (first) {
      const code = String(first.code || "");
      if (code.includes("user-not-found") || code.includes("invalid-credential")) {
        try {
          const c = await auth.createUserWithEmailAndPassword(email, password);
          await c.user.updateProfile({ displayName: "Chủ cửa hàng" });
          await ensureUserDoc(c.user);
          location.replace("app.html");
          return;
        } catch (createErr) { msg("Không tạo được tài khoản demo: " + friendly(createErr)); }
      } else msg(friendly(first));
    }
  } catch (e) { msg(friendly(e)); }
  setBusy(false);
}

window.addEventListener("DOMContentLoaded", () => {
  try {
    const auth = ensureFirebase();
    auth.onAuthStateChanged(user => {
      if (user && (/(?:^|\/)index\.html?$|(?:^|\/)$/).test(location.pathname)) location.replace("app.html");
    });
  } catch (e) { msg(friendly(e)); }

  $("loginForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    msg("");
    const email = $("loginUsername").value.trim(), pass = $("loginPassword").value;
    if (!email || !pass) { msg("Vui lòng nhập email và mật khẩu."); return; }
    setBusy(true);
    const r = await signIn(email, pass);
    if (r.success) { await ensureUserDoc(r.user); location.replace("app.html"); } else { msg(friendly(r.error)); setBusy(false); }
  });

  $("demoLoginBtn")?.addEventListener("click", demoLogin);
  $("googleLoginBtn")?.addEventListener("click", async () => {
    msg("");
    try {
      const auth = ensureFirebase();
      const p = new firebase.auth.GoogleAuthProvider();
      const r = await auth.signInWithPopup(p);
      await ensureUserDoc(r.user);
      location.replace("app.html");
    } catch (e) { msg(friendly(e)); }
  });
  $("facebookLoginBtn")?.addEventListener("click", async () => {
    msg("");
    try {
      const auth = ensureFirebase();
      const p = new firebase.auth.FacebookAuthProvider();
      const r = await auth.signInWithPopup(p);
      await ensureUserDoc(r.user);
      location.replace("app.html");
    } catch (e) { msg(friendly(e)); }
  });
});