// ==========================================
// 1. KONFIGURASI FIREBASE
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyA9-fz5YwCvVhTzV4mT65uQ727MWTOm32U",
  authDomain: "system-ocm.firebaseapp.com",
  databaseURL:
    "https://system-ocm-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "system-ocm",
  storageBucket: "system-ocm.firebasestorage.app",
  messagingSenderId: "433934854222",
  appId: "1:433934854222:web:39e21493d1a20d5c993b1f",
  measurementId: "G-WCT66Z2CCZ",
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// ==========================================
// 2. VARIABEL STATE APLIKASI
// ==========================================
let defaultUsers = { admin: { pass: "admin123", role: "admin" } };
let USERS = defaultUsers;
let currentDB = [];
let dailyValidation = {};
let BUGS = {};

let defaultEformFields = [
  { id: "f_nama", label: "Nama Lengkap", type: "text" },
  { id: "f_ttl", label: "Tempat, Tgl Lahir", type: "text" },
  { id: "f_domisili", label: "Domisili Saat Ini", type: "text" },
  { id: "f_hp", label: "No. HP Aktif", type: "number" },
  { id: "f_bpkb", label: "Ket. BPKB (A/n Sendiri/Orang Lain)", type: "text" },
  { id: "f_nominal", label: "Nominal Pinjaman (Rp)", type: "number" },
  { id: "f_tenor", label: "Tenor Pinjaman (Bulan)", type: "number" },
];
let EFORM_SETTINGS = [];
let PENGAJUAN_PINJAMAN = {};

let sessionDataStr = localStorage.getItem("userSession");
let loggedInUser = null;
if (sessionDataStr) {
  let parsedSession = JSON.parse(sessionDataStr);
  // Validasi apakah sesi sudah melewati batas waktu (jam 18:00)
  if (new Date().getTime() < parsedSession.expire) {
    loggedInUser = parsedSession.user;
  } else {
    localStorage.removeItem("userSession"); // Hapus jika sudah kadaluarsa
  }
}

let ocmIdx = localStorage.getItem("ocm_ongoing_idx");
let currentOngoingIndex =
  ocmIdx !== null && ocmIdx !== "null" && ocmIdx !== "undefined"
    ? parseInt(ocmIdx)
    : null;

let activeDay = 1;
let ITEMS_PER_DAY = 100;
let WA_DELAY = 0;
let WORK_ON_SUNDAY = false;
let lastWaTime = 0;
let WA_TEMPLATE =
  "Selamat pagi ka, apakah benar ini dengan kk [nama_konsumen]? Saya [nama_user] dari FIFGroup.";

let chartInstance = null;
window.countdownInterval = null;
let editingUserId = null;

// Sisi Web (JavaScript) - Logika Login Sesi
function setLoginSession(userData) {
  const now = new Date();
  // Set target ke jam 18:00:00 hari ini
  const expireTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    18,
    0,
    0,
  ).getTime();

  const sessionData = {
    user: userData,
    expire: expireTime,
  };
  localStorage.setItem("userSession", JSON.stringify(sessionData));
}

function checkSession() {
  const sessionStr = localStorage.getItem("userSession");
  if (!sessionStr) return false; // Belum login

  const sessionData = JSON.parse(sessionStr);
  const now = new Date().getTime();

  // Jika waktu sekarang melebihi waktu kadaluarsa (18:00)
  if (now > sessionData.expire) {
    localStorage.removeItem("userSession");
    alert("Sesi login berakhir. Silakan login kembali.");
    window.location.href = "/login"; // Arahkan ke login
    return false;
  }
  return true; // Sesi masih aman
}

// ==========================================
// 3. FUNGSI SIMPAN KE FIREBASE
// ==========================================
function saveUsers() {
  database.ref("ocm_users").update(USERS);
}

function saveValidation() {
  database.ref("ocm_validation").set(dailyValidation);
  if (typeof checkAutoApproveUser === "function") {
    checkAutoApproveUser();
  }
}
function saveState() {
  database.ref("ocm_main_db").set(currentDB);
  if (currentOngoingIndex !== null)
    localStorage.setItem("ocm_ongoing_idx", currentOngoingIndex);
  else localStorage.removeItem("ocm_ongoing_idx");
}

// ==========================================
// 4. SINKRONISASI REALTIME & MANAGEMENT LOADING
// ==========================================
let isDataLoaded = false;
let loadingInterval = null;
let currentProgress = 0;

window.onload = function () {
  if (loggedInUser) {
    mulaiLoadingProgress("Mengautentikasi sesi & mengunduh data utama...");
    muatDataLengkap();
  } else {
    mulaiLoadingProgress("Menyiapkan halaman login...");
    muatDataLoginOnly();
  }

  window.dbStatusInterval1 = setTimeout(() => {
    const txt = document.getElementById("loading-database-status");
    if (txt && !isDataLoaded)
      txt.innerText = "Sinkronisasi struktur data pengajuan pinjaman...";
  }, 1000);

  window.dbStatusInterval2 = setTimeout(() => {
    const txt = document.getElementById("loading-database-status");
    if (txt && !isDataLoaded)
      txt.innerText = "Menyusun baris tabel & rendering dashboard...";
  }, 2200);
};

let isLoginScreenInitialized = false;

function muatDataLoginOnly(callbackSukses) {
  database.ref("ocm_users").once(
    "value",
    (snapshot) => {
      USERS = snapshot.val() || defaultUsers;
      if (!isLoginScreenInitialized) {
        isLoginScreenInitialized = true;
        selesaikanLoadingProgress(() => {
          const loginScreen = document.getElementById("login-screen");
          if (loginScreen) loginScreen.classList.remove("hidden");
          const mainApp =
            document.getElementById("app-layout") ||
            document.getElementById("main-dashboard");
          if (mainApp) mainApp.classList.add("hidden");
          if (callbackSukses) callbackSukses();
        });
      }
    },
    (error) => {
      if (typeof matikanLoadingAwal === "function") matikanLoadingAwal();
      if (typeof showToast === "function")
        showToast("Gagal memuat data login: " + error.message, "error");
    },
  );
}

function muatDataLengkap(callbackSelesai) {
  let loaded = {
    settings: false,
    users: false,
    validation: false,
    bugs: false,
    eform: false,
    pengajuan: false,
    main: false,
  };

  function checkSemuaDataSelesai() {
    if (
      loaded.settings &&
      loaded.users &&
      loaded.validation &&
      loaded.bugs &&
      loaded.eform &&
      loaded.pengajuan &&
      loaded.main
    ) {
      if (!isDataLoaded) {
        isDataLoaded = true;
        if (loggedInUser && loggedInUser.role === "admin") {
          if (typeof renderAdminEformSubmissions === "function")
            renderAdminEformSubmissions();
          if (typeof renderEformBuilderList === "function")
            renderEformBuilderList();
        }
        if (typeof updateBugNotification === "function")
          updateBugNotification();

        selesaikanLoadingProgress(() => {
          const loginScreen = document.getElementById("login-screen");
          if (loginScreen) loginScreen.classList.add("hidden");

          const mainApp =
            document.getElementById("app-layout") ||
            document.getElementById("main-dashboard");
          if (mainApp) mainApp.classList.remove("hidden");

          if (typeof initApp === "function") initApp();
          if (callbackSelesai) callbackSelesai();
        });
      } else {
        // Di bagian atas file, buat variabel global
        let renderDebounceTimer = null;

        // Lalu ubah pemanggilan render pada fungsi checkSemuaDataSelesai() menjadi:
        if (window.isAppInitialized) {
          clearTimeout(renderDebounceTimer);
          renderDebounceTimer = setTimeout(() => {
            if (loggedInUser && loggedInUser.role === "admin") {
              if (typeof renderDashboard === "function") renderDashboard();
            } else if (loggedInUser) {
              if (typeof renderTabs === "function") renderTabs();
              if (typeof renderTable === "function") renderTable();
            }
          }, 500); // Tunggu 0.5 detik sebelum benar-benar memproses render ulang tabel
        }
      }
    }
  }

  database.ref("ocm_settings").on("value", (snapshot) => {
    const settings = snapshot.val() || {};
    ITEMS_PER_DAY = settings.items_per_day || 100;
    WA_DELAY = settings.wa_delay || 0;
    WORK_ON_SUNDAY = settings.work_on_sunday || false;
    WA_TEMPLATE =
      settings.wa_template ||
      "Selamat pagi ka, apakah benar ini dengan kk [nama_konsumen]? Saya [nama_user] dari FIFGroup.";
    const templateInput = document.getElementById("setting-wa-template");
    if (templateInput) templateInput.value = WA_TEMPLATE;
    loaded.settings = true;
    checkSemuaDataSelesai();
  });

  database.ref("ocm_users").on("value", (snapshot) => {
    USERS = snapshot.val() || defaultUsers;
    loaded.users = true;
    checkSemuaDataSelesai();
  });

  database.ref("ocm_validation").on("value", (snapshot) => {
    dailyValidation = snapshot.val() || {};
    loaded.validation = true;
    checkSemuaDataSelesai();
  });

  database.ref("ocm_bugs").on("value", (snapshot) => {
    BUGS = snapshot.val() || {};
    loaded.bugs = true;
    checkSemuaDataSelesai();
  });

  database.ref("ocm_eform_settings").on("value", (snapshot) => {
    EFORM_SETTINGS = snapshot.val() || defaultEformFields;
    loaded.eform = true;
    checkSemuaDataSelesai();
  });

  database.ref("pengajuan_pinjaman").on("value", (snapshot) => {
    PENGAJUAN_PINJAMAN = snapshot.val() || {};
    loaded.pengajuan = true;
    checkSemuaDataSelesai();
  });

  database.ref("ocm_main_db").on("value", (snapshot) => {
    let dbData = snapshot.val() || [];
    currentDB = Array.isArray(dbData) ? dbData : Object.values(dbData);
    loaded.main = true;
    checkSemuaDataSelesai();
  });

  // Listener untuk Pengumuman Admin
  database.ref("ocm_pengumuman").on("value", (snapshot) => {
    const data = snapshot.val();
    const container = document.getElementById("modern-admin-info-container");
    const textEl = document.getElementById("modern-admin-info-text");

    if (data && data.pesan) {
      const now = new Date().getTime();
      // Cek apakah pesan masih berlaku (Contoh: Menghilang otomatis setelah 2 Hari)
      const batasanWaktu = 2 * 24 * 60 * 60 * 1000;

      if (now - data.waktu < batasanWaktu) {
        container.classList.remove("hidden");

        // Jika disetel Marquee (Teks Berjalan)
        if (data.marquee) {
          textEl.innerHTML = `<marquee scrollamount="5" class="py-1">${data.pesan}</marquee>`;
        } else {
          textEl.innerHTML = data.pesan;
        }

        // Jika disetel Pop-up Real-time dan user belum pernah melihat pop-up ini
        const sessionKey = "notif_seen_" + data.waktu;
        if (data.realtime && !sessionStorage.getItem(sessionKey)) {
          showDialog("🔔 Pengumuman Admin", data.pesan, "alert");
          sessionStorage.setItem(sessionKey, "true");
        }
      } else {
        // Sembunyikan jika sudah kedaluwarsa (> 2 hari)
        container.classList.add("hidden");
      }
    } else {
      container.classList.add("hidden");
    }
  });
}

function mulaiLoadingProgress(pesanStatus = "Mengunduh Database...") {
  const loader = document.getElementById("initial-loading-screen");
  const circle = document.getElementById("loading-progress-circle");
  const text = document.getElementById("loading-percentage");
  const statusTxt = document.getElementById("loading-database-status");

  if (loader)
    loader.classList.remove("hidden", "opacity-0", "pointer-events-none");
  currentProgress = 0;
  if (statusTxt) statusTxt.innerText = pesanStatus;

  clearInterval(loadingInterval);
  loadingInterval = setInterval(() => {
    if (currentProgress < 90) {
      let increment =
        currentProgress < 60
          ? Math.floor(Math.random() * 8) + 2
          : Math.floor(Math.random() * 3) + 1;
      currentProgress += increment;
      if (currentProgress > 90) currentProgress = 90;
      updateProgressUI(currentProgress, circle, text);
    }
  }, 180);
}

function updateProgressUI(percent, circleEl, textEl) {
  if (textEl) textEl.innerText = percent + "%";
  if (circleEl) {
    const offset = 283 - (283 * percent) / 100;
    circleEl.style.strokeDashoffset = offset;
  }
}

function selesaikanLoadingProgress(callback) {
  if (typeof loadingInterval !== "undefined") {
    clearInterval(loadingInterval);
  }

  const circle = document.getElementById("loading-progress-circle");
  const text = document.getElementById("loading-percentage");

  if (circle || text) {
    if (typeof updateProgressUI === "function") {
      updateProgressUI(100, circle, text);
    }
  }

  setTimeout(() => {
    if (typeof matikanLoadingAwal === "function") {
      matikanLoadingAwal();
    }
    if (callback) callback();
  }, 600);
}

function matikanLoadingAwal() {
  clearInterval(loadingInterval);
  clearTimeout(window.dbStatusInterval1);
  clearTimeout(window.dbStatusInterval2);

  const loader = document.getElementById("initial-loading-screen");
  const statusTxt = document.getElementById("loading-database-status");

  if (loader) {
    if (statusTxt) statusTxt.innerText = "Selesai! Membuka halaman...";
    loader.classList.add("opacity-0", "pointer-events-none");
    setTimeout(() => {
      loader.classList.add("hidden");
    }, 500);
  }
}

// --- UTILS & TOASTS ---
function showLoading() {
  document.getElementById("loading-screen").classList.remove("hidden");
  setTimeout(() => {
    document.getElementById("loading-screen").classList.remove("opacity-0");
  }, 10);
}
function hideLoading() {
  document.getElementById("loading-screen").classList.add("opacity-0");
  setTimeout(() => {
    document.getElementById("loading-screen").classList.add("hidden");
  }, 300);
}

// --- UTILS & TOASTS ---
function showToast(msg, type = "info") {
  let container = document.getElementById("toast-container"); //

  // [PERBAIKAN BUG]: Jika container tidak ditemukan di HTML, sistem akan otomatis membuatkannya
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    // Memastikan posisi notifikasi berada di atas semua layar loading (z-[9999])
    container.className = "fixed top-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div"); //[cite: 1]

  // Warna yang lebih modern dengan backdrop blur[cite: 1]
  let bgClass = "bg-slate-800/90 text-white border-slate-700"; //[cite: 1]
  let icon = `<svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`; //[cite: 1]

  if (type === "success") { //[cite: 1]
    bgClass = "bg-emerald-50/95 text-emerald-900 border-emerald-200"; //[cite: 1]
    icon = `<svg class="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`; //[cite: 1]
  } else if (type === "error") { //[cite: 1]
    bgClass = "bg-rose-50/95 text-rose-900 border-rose-200"; //[cite: 1]
    icon = `<svg class="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`; //[cite: 1]
  }

  toast.className = `flex items-center gap-3 px-4 py-3.5 rounded-2xl shadow-xl backdrop-blur-md border transform translate-x-full opacity-0 transition-all duration-400 ease-out z-[9999] min-w-[280px] max-w-sm cursor-pointer hover:scale-[1.02] ${bgClass}`; //[cite: 1]

  toast.innerHTML = `
        <div class="flex-shrink-0">${icon}</div>
        <span class="text-sm font-semibold tracking-wide flex-1">${msg}</span>
        <button onclick="this.parentElement.remove()" class="text-current opacity-60 hover:opacity-100 transition-opacity p-1">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
    `; //[cite: 1]

  // Tambahkan langsung ke container tanpa harus mengecek ulang
  container.appendChild(toast);

  // Trigger Animasi Masuk[cite: 1]
  requestAnimationFrame(() => { //[cite: 1]
    setTimeout(() => { //[cite: 1]
      toast.classList.remove("translate-x-full", "opacity-0"); //[cite: 1]
    }, 10); //[cite: 1]
  }); //[cite: 1]

  // Auto Hapus Animasi[cite: 1]
  setTimeout(() => { //[cite: 1]
    toast.classList.add("opacity-0", "translate-x-8"); //[cite: 1]
    setTimeout(() => toast.remove(), 400); //[cite: 1]
  }, 4000); //[cite: 1]
}

// --- CUSTOM MODAL SYSTEM ---
let dialogConfirmCallback = null;
function showDialog(title, message, type = "alert", onConfirm = null) {
  dialogConfirmCallback = onConfirm;
  document.getElementById("custom-dialog-title").innerText = title;
  document.getElementById("custom-dialog-message").innerText = message;
  const btnContainer = document.getElementById("custom-dialog-buttons");
  if (type === "confirm") {
    btnContainer.innerHTML = `<button onclick="closeDialog()" class="px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all cursor-pointer">Batal</button><button onclick="confirmDialog()" class="px-5 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-xl transition-all shadow-md cursor-pointer">Ya, Mengerti & Lanjutkan</button>`;
  } else {
    btnContainer.innerHTML = `<button onclick="closeDialog()" class="px-5 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-xl transition-all shadow-md cursor-pointer w-full">Mengerti</button>`;
  }
  const overlay = document.getElementById("custom-dialog-overlay");
  const box = document.getElementById("custom-dialog-box");
  overlay.classList.remove("hidden");
  requestAnimationFrame(() => {
    overlay.classList.remove("opacity-0");
    box.classList.remove("scale-90");
  });
}

function closeDialog() {
  const overlay = document.getElementById("custom-dialog-overlay");
  const box = document.getElementById("custom-dialog-box");
  overlay.classList.add("opacity-0");
  box.classList.add("scale-90");
  setTimeout(() => {
    overlay.classList.add("hidden");
  }, 300);
  dialogConfirmCallback = null;
}

function confirmDialog() {
  if (dialogConfirmCallback) dialogConfirmCallback();
  closeDialog();
}

function copyText(elementId, btnId) {
  let el = document.getElementById(elementId);
  if (!el) return showToast("Gagal: Elemen teks tidak ditemukan", "error");

  let textToCopy = el.innerText || el.textContent;
  textToCopy = textToCopy
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => successFeedback())
      .catch((err) => fallbackCopy(textToCopy));
  } else {
    fallbackCopy(textToCopy);
  }

  function fallbackCopy(text) {
    let textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      let successful = document.execCommand("copy");
      if (successful) {
        if (typeof successFeedback === "function") {
          successFeedback();
        } else {
          showToast("Teks berhasil disalin!", "success");
        }
      } else {
        showToast("Gagal menyalin teks.", "error");
      }
    } catch (err) {
      showToast("Browser tidak mendukung fitur salin.", "error");
    }

    document.body.removeChild(textArea);
  }

  function successFeedback() {
    const btn = document.getElementById(btnId);
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<span class="text-[10px] text-emerald-600 font-bold px-1">Tersalin!</span>`;
    setTimeout(() => {
      btn.innerHTML = originalHTML;
    }, 1500);
  }
}

// --- SISTEM LAPOR BUG ---
function openBugModal() {
  document.getElementById("bug-msg").value = "";
  const modal = document.getElementById("user-bug-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  setTimeout(() => modal.classList.remove("opacity-0"), 10);
}

function closeBugModal() {
  const modal = document.getElementById("user-bug-modal");
  modal.classList.add("opacity-0");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 300);
}

function submitBug() {
  let msgInput = document.getElementById("bug-msg");
  if (!msgInput) return;

  let msg = msgInput.value.trim();
  if (!msg) return showToast("Pesan laporan bug tidak boleh kosong!", "error");

  msg = escapeHTML(msg);

  const newBug = {
    user: loggedInUser.username,
    name:
      USERS[loggedInUser.username]?.name || loggedInUser.username.toUpperCase(),
    message: msg,
    date: new Date().toLocaleString("id-ID"),
    isRead: false,
  };

  database
    .ref("ocm_bugs")
    .push(newBug)
    .then(() => {
      showToast("Laporan bug berhasil dikirim.", "success");
      msgInput.value = "";
      if (typeof closeBugModal === "function") closeBugModal();
    })
    .catch((err) => {
      showToast("Gagal mengirim laporan.", "error");
      console.error(err);
    });
}

function updateBugNotification() {
  if (!loggedInUser || loggedInUser.role !== "admin") return;
  const badge = document.getElementById("bug-notif-badge");
  if (!badge) return;

  let hasUnread = false;

  if (BUGS && typeof BUGS === "object") {
    for (let key in BUGS) {
      if (BUGS.hasOwnProperty(key) && BUGS[key].isRead === false) {
        hasUnread = true;
        break;
      }
    }
  }

  if (hasUnread) {
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function openAdminBugModal() {
  const modal = document.getElementById("admin-bug-modal");
  const list = document.getElementById("admin-bug-list");
  list.innerHTML = "";

  let hasData = false;
  let updates = {};

  for (let key in BUGS) {
    hasData = true;
    let b = BUGS[key];
    let badgeHTML = b.isRead
      ? `<span class="text-[9px] text-slate-400 font-normal">Dibaca</span>`
      : `<span class="text-[9px] bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full font-bold">Baru</span>`;

    let itemHTML = `
        <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200 mb-3 shadow-sm ${b.isRead ? "" : "border-l-4 border-l-rose-500"}">
            <div class="flex justify-between items-start mb-2">
                <span class="text-xs font-bold text-slate-800">${b.name} <span class="text-slate-500 font-normal ml-1">(ID: ${b.user.toUpperCase()})</span></span>
                <span class="text-[10px] text-slate-500 font-mono">${b.date} ${badgeHTML}</span>
            </div>
            <p class="text-sm text-slate-700 whitespace-pre-wrap">${b.message}</p>
        </div>`;

    list.innerHTML = itemHTML + list.innerHTML;

    if (!b.isRead) updates[`ocm_bugs/${key}/isRead`] = true;
  }

  if (!hasData)
    list.innerHTML =
      '<p class="text-sm text-slate-400 text-center py-6 font-medium">✨ Belum ada laporan bug sistem yang masuk.</p>';
  if (Object.keys(updates).length > 0) database.ref().update(updates);

  modal.classList.remove("hidden");
  modal.classList.add("flex");
  setTimeout(() => modal.classList.remove("opacity-0"), 10);
}

function closeAdminBugModal() {
  const modal = document.getElementById("admin-bug-modal");
  modal.classList.add("opacity-0");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 300);
}

// --- MASTER ADMIN MODAL FUNCTIONS ---
function openMasterSettingsModal() {
  document.getElementById("edit-admin-user").value = loggedInUser.username;
  document.getElementById("edit-admin-pass").value = USERS[
    loggedInUser.username
  ]
    ? USERS[loggedInUser.username].pass
    : "";
  document.getElementById("edit-admin-name").value =
    USERS[loggedInUser.username]?.name || "";
  document.getElementById("edit-admin-photo").value = "";

  updateUserSelector();
  renderUserGDriveSettings();
  renderModalUserList();
  switchAdminTab("upload");
  resetUserForm();
  updateWaTemplateUserSelector();

  const modal = document.getElementById("master-admin-settings-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  document.body.style.overflow = "hidden";

  setTimeout(() => {
    modal.classList.remove("opacity-0");
  }, 10);
}

function closeMasterSettingsModal() {
  const modal = document.getElementById("master-admin-settings-modal");
  modal.classList.add("opacity-0");
  document.body.style.overflow = "";

  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 300);
}

function switchAdminTab(tabName) {
  document
    .querySelectorAll(".admin-tab-content")
    .forEach((el) => el.classList.add("hidden"));
  document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
    btn.classList.remove("bg-blue-600", "text-white", "shadow-md");
    btn.classList.add("text-slate-600", "hover:bg-slate-50");
  });
  document
    .getElementById(`content-admin-${tabName}`)
    .classList.remove("hidden");
  document
    .getElementById(`btn-admin-${tabName}`)
    .classList.remove("text-slate-600", "hover:bg-slate-50");
  document
    .getElementById(`btn-admin-${tabName}`)
    .classList.add("bg-blue-600", "text-white", "shadow-md");
}

function renderUserGDriveSettings() {
  const container = document.getElementById("user-gdrive-settings-container");
  if (!container) return;
  container.innerHTML = "";
  let hasUsers = false;
  for (let u in USERS) {
    if (USERS[u].role === "admin") continue;
    hasUsers = true;
    let currentUrl = USERS[u].gdrive_upload_url || "";
    let uName = USERS[u].name || u.toUpperCase();
    container.innerHTML += `
        <div class="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5 shadow-sm">
            <span class="text-xs font-bold text-slate-700 uppercase">${uName} (ID: ${u.toUpperCase()})</span>
            <div class="flex gap-2">
                <input type="text" id="gdrive-url-${u}" value="${currentUrl}" placeholder="Link Folder Google Drive User..." class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500">
                <button onclick="saveUserGDriveUrl('${u}')" class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all shrink-0 cursor-pointer">Simpan</button>
            </div>
        </div>`;
  }
  if (!hasUsers)
    container.innerHTML =
      '<p class="text-xs text-slate-400 italic text-center py-2">Belum ada user karyawan terdaftar.</p>';
}

function saveUserGDriveUrl(user) {
  const urlVal = document.getElementById(`gdrive-url-${user}`).value.trim();
  if (!USERS[user]) return;
  USERS[user].gdrive_upload_url = urlVal;
  saveUsers();
  showToast(`Link GDrive ${user.toUpperCase()} diperbarui!`, "success");
}

function updateWaTemplateUserSelector() {
  const sel = document.getElementById("wa-template-user-selector");
  if (!sel) return;
  sel.innerHTML = "";
  for (let u in USERS) {
    if (USERS[u].role !== "admin") {
      let displayName = USERS[u].name || u.toUpperCase();
      sel.innerHTML += `<option value="${u}">${displayName} (ID: ${u.toUpperCase()})</option>`;
    }
  }
  loadUserWaTemplates();
}

function loadUserWaTemplates() {
  const user = document.getElementById("wa-template-user-selector").value;
  if (!user || !USERS[user]) return;

  let templates = USERS[user].wa_templates || {};
  const pagi = document.getElementById("wa-template-pagi");
  const siang = document.getElementById("wa-template-siang");
  const sore = document.getElementById("wa-template-sore");

  if (pagi) pagi.value = templates.pagi || "";
  if (siang) siang.value = templates.siang || "";
  if (sore) sore.value = templates.sore || "";
}

function saveUserWaTemplates() {
  const user = document.getElementById("wa-template-user-selector").value;
  if (!user || !USERS[user]) {
    if (typeof showToast === "function")
      showToast("Pilih user terlebih dahulu!", "error");
    return;
  }

  const templatePagi =
    document.getElementById("wa-template-pagi")?.value.trim() || "";
  const templateSiang =
    document.getElementById("wa-template-siang")?.value.trim() || "";
  const templateSore =
    document.getElementById("wa-template-sore")?.value.trim() || "";

  if (!USERS[user].wa_templates) {
    USERS[user].wa_templates = {};
  }

  USERS[user].wa_templates.pagi = templatePagi;
  USERS[user].wa_templates.siang = templateSiang;
  USERS[user].wa_templates.sore = templateSore;

  saveUsers();
  if (typeof showToast === "function") {
    showToast(
      `Template WA untuk ${USERS[user].name || user.toUpperCase()} berhasil disimpan!`,
      "success",
    );
  }
}

function handleLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  showLoading();
  const reader = new FileReader();
  reader.onload = function (e) {
    database
      .ref("ocm_settings/logo_url")
      .set(e.target.result)
      .then(() => {
        hideLoading();
        showToast("Logo utama website berhasil diubah!", "success");
      })
      .catch(() => {
        hideLoading();
        showToast("Gagal menyimpan logo.", "error");
      });
  };
  reader.readAsDataURL(file);
}

function resetWebsiteLogo() {
  showDialog(
    "Reset Logo?",
    "Kembalikan logo default lambang sistem?",
    "confirm",
    () => {
      showLoading();
      database
        .ref("ocm_settings/logo_url")
        .remove()
        .then(() => {
          hideLoading();
          showToast("Logo dikembalikan ke default.", "success");
        });
    },
  );
}

function handleLogin() {
  if (!isLoginScreenInitialized) {
    //
    return showToast(
      //[cite: 1]
      "Database sedang dihubungkan, mohon tunggu sebentar...", //[cite: 1]
      "info", //[cite: 1]
    ); //[cite: 1]
  }

  if (!USERS || Object.keys(USERS).length === 0) {
    //[cite: 1]
    return showToast(
      //[cite: 1]
      "Sistem sedang menyiapkan data akun, mohon tunggu sebentar...", //[cite: 1]
      "info", //[cite: 1]
    ); //[cite: 1]
  }

  const userEl = document.getElementById("login-username"); //[cite: 1]
  const passEl = document.getElementById("login-password"); //[cite: 1]

  if (!userEl || !passEl) {
    //[cite: 1]
    return showToast(
      "Halaman sedang dimuat, harap tunggu beberapa detik.",
      "error",
    ); //[cite: 1]
  }

  const user = userEl.value.toLowerCase().trim(); //[cite: 1]
  const pass = passEl.value.trim(); //[cite: 1]

  if (!user || !pass) return showToast("Masukkan ID dan Password!", "error"); //[cite: 1]

  // --- LOGIKA PENGECEKAN ID BARU ---
  if (!USERS[user]) {
    // Jika ID tidak ditemukan di dalam objek USERS
    return showToast("ID Tidak Terdaftar", "error");
  } else if (String(USERS[user].pass) !== pass) {
    // Jika ID ditemukan, tetapi password tidak cocok
    return showToast("Password salah!", "error");
  } else {
    // Jika ID dan Password cocok (Berhasil Login)
    loggedInUser = { username: user, role: USERS[user].role }; //[cite: 1]
    sessionStorage.setItem("ocm_session", JSON.stringify(loggedInUser)); //[cite: 1]

    document //[cite: 1]
      .getElementById("login-screen") //[cite: 1]
      .classList.add("opacity-0", "scale-105"); //[cite: 1]

    setTimeout(() => {
      //[cite: 1]
      document.getElementById("login-screen").classList.add("hidden"); //[cite: 1]

      if (
        //[cite: 1]
        typeof mulaiLoadingProgress === "function" && //[cite: 1]
        typeof muatDataLengkap === "function" //[cite: 1]
      ) {
        //[cite: 1]
        mulaiLoadingProgress("Berhasil! Mengunduh data Dashboard & Laporan..."); //[cite: 1]
        muatDataLengkap(() => {
          //[cite: 1]
          showLoginSuccessPopup(loggedInUser); //[cite: 1]
        }); //[cite: 1]
      } else {
        //[cite: 1]
        showLoginSuccessPopup(loggedInUser); //[cite: 1]
      } //[cite: 1]
    }, 500); //[cite: 1]
  }
}

function showLoginSuccessPopup(user) {
  let currentUserData = USERS[user.username] || {};
  let displayName = currentUserData.name || user.username.toUpperCase();
  let photoUrl =
    currentUserData.photo ||
    `https://ui-avatars.com/api/?name=${displayName}&background=0D8ABC&color=fff`;

  document.getElementById("popup-user-photo").src = photoUrl;
  document.getElementById("popup-greeting").innerText = `Halo, ${displayName}!`;
  document.getElementById("popup-id-display").innerText =
    `ID: ${user.username.toUpperCase()}`;

  const clockEl = document.getElementById("popup-realtime-clock");
  if (clockEl) {
    const updateClock = () => {
      const now = new Date();
      const options = {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      };
      clockEl.innerText = now
        .toLocaleString("id-ID", options)
        .replace(/\./g, ":");
    };
    updateClock();
    window.popupClockInterval = setInterval(updateClock, 1000);
  }

  const motivationQuotes = [
    "Target bukan sekadar angka, tapi pembuktian dedikasi kita! Semangat closing!",
    "Setiap penolakan adalah satu langkah lebih dekat menuju kata 'DEAL'.",
    "Kerja keras hari ini, panen komisi dan rezeki esok hari! Gasss!",
    "Jangan tunggu peluang datang, ciptakan peluangmu sendiri hari ini!",
    "Fokus, Konsisten, Closing! Mari cetak rekor baru hari ini!",
    "Target di depan mata. Ayo raih dan jadilah Top Achiever bulan ini!",
  ];
  document.getElementById("popup-motivation").innerText =
    motivationQuotes[Math.floor(Math.random() * motivationQuotes.length)];

  const popup = document.getElementById("login-success-popup");
  popup.classList.remove("hidden");
  popup.classList.add("flex");
  setTimeout(() => popup.classList.remove("opacity-0"), 50);
}

function closeLoginPopup() {
  if (window.popupClockInterval) clearInterval(window.popupClockInterval);
  const popup = document.getElementById("login-success-popup");
  popup.classList.add("opacity-0");
  setTimeout(() => {
    popup.classList.add("hidden");
    popup.classList.remove("flex");
  }, 300);
}

function logout() {
  localStorage.removeItem("userSession"); // Sesuaikan dengan key saat login
  window.location.reload();
}

// --- CHECKER AUTO APPROVE ---
function checkAutoApproveUser() {
  if (!loggedInUser) return;

  let nowHours = new Date().getHours();
  let isAutoApproveTime = nowHours >= 19 || nowHours < 7;

  if (isAutoApproveTime && dailyValidation[loggedInUser.username]) {
    let updated = false;

    for (let day in dailyValidation[loggedInUser.username]) {
      let val = dailyValidation[loggedInUser.username][day];

      if (val.status === "pending") {
        if (val.link && val.link.trim() !== "") {
          val.status = "approved";
          val.autoApproved = true;
          val.approvedAt = Date.now();
          updated = true;
        } else {
          console.log(
            `Menunggu user upload bukti kerja untuk hari ke-${day} sebelum auto-approve.`,
          );
        }
      }
    }

    if (updated) {
      saveValidation();
      showToast(
        "Tugas disetujui otomatis (Berada di luar jam kerja admin).",
        "success",
      );
      if (typeof renderTabs === "function") renderTabs();
      if (typeof renderValidationPanel === "function") renderValidationPanel();
    }
  }
}

// --- INIT APP & NAVIGATION ---
function initApp() {
  if (window.isAppInitialized) return;
  window.isAppInitialized = true;

  let currentUserData = USERS[loggedInUser.username] || {};
  let displayName = currentUserData.name || loggedInUser.username.toUpperCase();

  const btnDistributor = document.getElementById("btn-distributor");
  if (btnDistributor) {
    if (loggedInUser && loggedInUser.role === "admin") {
      btnDistributor.classList.remove("hidden"); // Tampilkan jika admin
    } else {
      btnDistributor.classList.add("hidden"); // Tetap sembunyikan jika bukan admin
    }
  }

  document.getElementById("display-username").innerText = loggedInUser.username;
  document.getElementById("header-user-name").innerText = displayName;

  const headerPhoto = document.getElementById("header-user-photo");
  if (headerPhoto) {
    const fallbackLogo = document.getElementById("login-logo-img")?.src || "";
    headerPhoto.src = currentUserData.photo || fallbackLogo;
  }

  document.getElementById("main-app").classList.remove("hidden");

  if (loggedInUser.role === "admin") {
    document.getElementById("admin-controls").classList.remove("hidden");
    document.getElementById("admin-controls").classList.add("flex");
    document.getElementById("btn-admin-bugs").classList.remove("hidden");
    document.getElementById("workspace-view").classList.add("hidden");
    document.getElementById("dashboard-view").classList.remove("hidden");
    const notifBanner = document.getElementById("user-notif-banner");
    if (notifBanner) notifBanner.classList.add("hidden");
    renderDashboard();
    updateBugNotification();
  } else {
    // [TAMBAHKAN KODE INI DI DALAM initApp() BAGIAN ELSE / USER]
    let waktuLogin = Date.now();
    database.ref("ocm_broadcasts").on("child_added", (snapshot) => {
      let notif = snapshot.val();
      // Hanya tampilkan notifikasi jika pesan dikirim SETELAH user ini login
      if (notif.timestamp > waktuLogin) {
        // Pemicu Notifikasi HP Android (Memanggil fungsi dari Kotlin)
        if (window.AndroidApp && window.AndroidApp.showNotification) {
          window.AndroidApp.showNotification(notif.title, notif.message);
        }
        // Pemicu Notifikasi Toast UI Web
        if (typeof showToast === "function") {
          showToast("🔔 Pengumuman Admin: " + notif.message, "info");
        }
      }
    });
    document.getElementById("btn-lapor-bug").classList.remove("hidden");
    document.getElementById("workspace-view").classList.remove("hidden");
    document.getElementById("dashboard-view").classList.add("hidden");
    renderTabs();
    if (typeof activeDay !== "number") activeDay = 1;
    setDay(activeDay);

    if (window.autoApproveInterval) clearInterval(window.autoApproveInterval);
    window.autoApproveInterval = setInterval(() => {
      checkAutoApproveUser();
    }, 60000);
  }
}

// FUNGSI KHUSUS ADMIN UNTUK MENGIRIM NOTIFIKASI
function kirimNotifikasiAdmin() {
  const modal = document.getElementById("modern-notif-modal");
  document.getElementById("input-notif-msg").value = "";
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modal.querySelector(".bg-white").classList.remove("scale-90");
  }, 10);
}

function closeNotifModal() {
  const modal = document.getElementById("modern-notif-modal");
  modal.classList.add("opacity-0");
  modal.querySelector(".bg-white").classList.add("scale-90");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 300);
}

function prosesKirimNotifikasi() {
  const msg = document.getElementById("input-notif-msg").value.trim();
  const isRealtime = document.getElementById("check-realtime").checked;
  const isMarquee = document.getElementById("check-marquee").checked;

  if (!msg) {
    if (typeof showToast === "function")
      showToast("Pesan tidak boleh kosong!", "error");
    return;
  }

  const payload = {
    pesan: msg,
    realtime: isRealtime,
    marquee: isMarquee,
    timestamp: Date.now(), // Simpan waktu saat ini untuk batas 2 hari
    sender: loggedInUser ? loggedInUser.username : "Admin",
  };

  // Simpan ke Firebase
  database
    .ref("ocm_global_notif")
    .set(payload)
    .then(() => {
      if (typeof showToast === "function")
        showToast("Notifikasi berhasil dikirim!", "success");
      closeNotifModal();
    })
    .catch((err) => {
      if (typeof showToast === "function")
        showToast("Gagal mengirim notifikasi.", "error");
    });
}

// ==========================================
// LISTENER REALTIME & LOGIKA 2 HARI (USER)
// ==========================================
database.ref("ocm_global_notif").on("value", (snapshot) => {
  const notif = snapshot.val();
  if (!notif) return;

  // TAMBAHAN KRUSIAL: Blokir admin dari menerima notifikasi miliknya sendiri
  if (loggedInUser && loggedInUser.role === "admin") {
    return;
  }

  const sekarang = Date.now();
  const duaHariDalamMs = 2 * 24 * 60 * 60 * 1000;

  // PEMBARUAN: Menargetkan elemen UI Info Admin yang baru
  const infoContainer = document.getElementById("modern-admin-info-container");
  const infoTextEl = document.getElementById("modern-admin-info-text");

  if (infoContainer && infoTextEl) {
    // Cek apakah umur notifikasi belum lewat 2 hari (48 jam)
    if (sekarang - notif.timestamp <= duaHariDalamMs) {
      infoTextEl.innerText = notif.pesan;
      infoContainer.classList.remove("hidden");
    } else {
      infoContainer.classList.add("hidden");
      infoTextEl.innerText = "";
    }
  }

  // 2. FITUR LAMA DIPERTAHANKAN: Realtime Web & APK Android
  // Hanya picu notifikasi langsung jika pesan baru saja dikirim (kurang dari 10 detik yang lalu)
  if (notif.realtime && sekarang - notif.timestamp < 10000) {
    // A. Pemicu Notifikasi HP Android (Memanggil fungsi dari Kotlin/Java APK)
    if (window.AndroidApp && window.AndroidApp.showNotification) {
      window.AndroidApp.showNotification("Pengumuman SFDM", notif.pesan);
    }

    // B. Pemicu Notifikasi UI Web (Toast)
    if (typeof showToast === "function") {
      showToast("🔔 Pengumuman Admin: " + notif.pesan, "info");
    }
  }
});

// --- MANAJEMEN USER BARU (DALAM MODAL) ---
function resetUserForm() {
  editingUserId = null;
  document.getElementById("user-form-title").innerText = "Tambah User Baru";
  document.getElementById("user-form-id").value = "";
  document.getElementById("user-form-id").disabled = false;
  document.getElementById("user-form-id").classList.remove("bg-slate-200");
  document.getElementById("user-form-name").value = "";
  document.getElementById("user-form-pass").value = "";
  document.getElementById("user-form-photo").value = "";
}

function editUser(id) {
  let user = USERS[id];
  if (!user) return;
  editingUserId = id;
  document.getElementById("user-form-title").innerText =
    `Edit User: ${id.toUpperCase()}`;
  document.getElementById("user-form-id").value = id;
  document.getElementById("user-form-id").disabled = true;
  document.getElementById("user-form-id").classList.add("bg-slate-200");
  document.getElementById("user-form-name").value = user.name || "";
  document.getElementById("user-form-pass").value = user.pass || "";
  document.getElementById("user-form-photo").value = "";
}

function saveEmployee() {
  let id = document.getElementById("user-form-id").value.trim().toLowerCase();
  let name = document.getElementById("user-form-name").value.trim();
  let pass = document.getElementById("user-form-pass").value.trim();
  let photoInput = document.getElementById("user-form-photo");

  if (!id || !name || !pass)
    return showToast("ID, Nama Lengkap, dan Password wajib diisi!", "error");
  if (!editingUserId && USERS[id])
    return showToast("ID Login ini sudah terdaftar!", "error");

  let saveToDB = (photoBase64) => {
    if (!USERS[id]) {
      USERS[id] = { role: "user", gdrive_upload_url: "" };
    }
    USERS[id].pass = pass;
    USERS[id].name = name;
    if (photoBase64 !== undefined) USERS[id].photo = photoBase64;

    saveUsers();
    showToast(
      editingUserId
        ? "Data user diperbarui!"
        : "User baru berhasil ditambahkan!",
      "success",
    );
    resetUserForm();
    renderModalUserList();
    if (loggedInUser.role === "admin") renderDashboard();
  };

  if (photoInput.files && photoInput.files[0]) {
    showLoading();
    const reader = new FileReader();
    reader.onload = function (e) {
      hideLoading();
      saveToDB(e.target.result);
    };
    reader.readAsDataURL(photoInput.files[0]);
  } else {
    saveToDB(editingUserId ? undefined : null);
  }
}

function renderModalUserList() {
  const list = document.getElementById("modal-user-list");
  if (!list) return;
  list.innerHTML = "";
  for (let u in USERS) {
    if (USERS[u].role === "admin") continue;
    let user = USERS[u];
    let displayName = user.name || u.toUpperCase();
    let photoSrc =
      user.photo ||
      `https://ui-avatars.com/api/?name=${displayName}&background=0D8ABC&color=fff`;

    list.innerHTML += `
        <li class="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-200 shadow-sm transition-all hover:border-blue-300">
            <div class="flex items-center gap-3">
                <img src="${photoSrc}" class="w-10 h-10 rounded-full border border-slate-200 object-cover shadow-sm">
                <div>
                    <span class="text-sm font-bold text-slate-800">${displayName}</span>
                    <span class="text-[11px] font-medium text-slate-500 block">ID Login: <span class="font-bold text-blue-600 uppercase">${u}</span> | Pass: <span class="font-mono text-slate-700">${user.pass}</span></span>
                </div>
            </div>
            <div class="flex flex-col md:flex-row gap-2">
                <button onclick="editUser('${u}')" class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer">Edit</button>
                <button onclick="removeUser('${u}')" class="text-xs bg-rose-50 hover:bg-rose-500 hover:text-white text-rose-600 font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer border border-rose-200 hover:border-transparent">Hapus</button>
            </div>
        </li>`;
  }
  updateUserSelector();
  renderUserGDriveSettings();
}

function removeUser(id) {
  showDialog(
    "Konfirmasi Hapus",
    `Yakin menghapus User [${id.toUpperCase()}]?`,
    "confirm",
    () => {
      delete USERS[id];
      saveUsers();
      renderModalUserList();
      if (loggedInUser.role === "admin") renderDashboard();
      showToast(`User ${id.toUpperCase()} dihapus`, "success");
    },
  );
}

function updateUserSelector() {
  const sel = document.getElementById("admin-user-selector");
  const clearSel = document.getElementById("clear-db-user-select");
  if (sel) {
    sel.innerHTML = "";
    for (let u in USERS) {
      if (USERS[u].role !== "admin") {
        let displayName = USERS[u].name || u.toUpperCase();
        sel.innerHTML += `<option value="${u}">Kirim Bahan OCM ke: ${displayName} (ID: ${u.toUpperCase()})</option>`;
      }
    }
  }
  if (clearSel) {
    clearSel.innerHTML = '<option value="all">⚠️ Hapus SEMUA Data</option>';
    let activeDbUsers = new Set();
    currentDB.forEach((d) => {
      if (d.kodeUser && d.kodeUser !== "admin") activeDbUsers.add(d.kodeUser);
    });
    for (let u in USERS) {
      if (USERS[u].role !== "admin") activeDbUsers.add(u);
    }
    activeDbUsers.forEach((u) => {
      let displayName =
        USERS[u] && USERS[u].name ? USERS[u].name : u.toUpperCase();
      let label = USERS[u]
        ? `Hanya Hapus Data: ${displayName} (${u.toUpperCase()})`
        : `Hapus Data Tanpa Owner: ${u.toUpperCase()}`;
      clearSel.innerHTML += `<option value="${u}">${label}</option>`;
    });
  }
}

// --- DASHBOARD ADMIN ---
function renderDashboard() {
  let total = currentDB.length;
  let selesai = 0,
    belum = 0,
    gagal = 0;
  let userStats = {};
  for (let u in USERS) {
    if (USERS[u].role !== "admin")
      userStats[u] = { total: 0, selesai: 0, belum: 0, gagal: 0, proses: 0 };
  }

  currentDB.forEach((item) => {
    let usr = item.kodeUser || "unknown";
    if (!userStats[usr])
      userStats[usr] = { total: 0, selesai: 0, belum: 0, gagal: 0, proses: 0 };
    userStats[usr].total++;
    if (item.status === "Selesai") {
      selesai++;
      userStats[usr].selesai++;
    } else if (item.status === "Gagal") {
      gagal++;
      userStats[usr].gagal++;
    } else if (item.status === "Proses") {
      belum++;
      userStats[usr].proses++;
    } else {
      belum++;
      userStats[usr].belum++;
    }
  });

  if (document.getElementById("dash-tot-all"))
    document.getElementById("dash-tot-all").innerText = total;
  if (document.getElementById("dash-tot-selesai"))
    document.getElementById("dash-tot-selesai").innerText = selesai;
  if (document.getElementById("dash-tot-gagal"))
    document.getElementById("dash-tot-gagal").innerText = gagal;
  if (document.getElementById("dash-tot-belum"))
    document.getElementById("dash-tot-belum").innerText = belum;

  const tbody = document.getElementById("dashboard-table-body");
  if (tbody) tbody.innerHTML = "";
  let labels = [],
    dataSelesai = [],
    dataGagal = [];

  for (let usr in userStats) {
    if (userStats[usr].total === 0 && !USERS[usr]) continue;
    let s = userStats[usr];
    let sisa = s.belum + s.proses;
    let rate = s.total > 0 ? Math.round((s.selesai / s.total) * 100) : 0;
    let isDeleted = !USERS[usr];
    let displayName =
      USERS[usr] && USERS[usr].name ? USERS[usr].name : usr.toUpperCase();
    let nameTag =
      displayName +
      ` <span class="text-[10px] text-slate-400 font-normal ml-1">(ID: ${usr.toUpperCase()})</span>` +
      (isDeleted
        ? ' <span class="text-[9px] text-rose-500 bg-rose-50 px-1 rounded ml-1 font-bold">DELETED</span>'
        : "");

    labels.push(displayName);
    dataSelesai.push(s.selesai);
    dataGagal.push(s.gagal);
    if (tbody)
      tbody.innerHTML += `<tr class="hover:bg-slate-50/50 transition-colors"><td class="py-3 px-6 font-bold text-slate-700">${nameTag}</td><td class="py-3 px-6 text-center font-mono">${s.total}</td><td class="py-3 px-6 text-center font-bold text-emerald-600">${s.selesai}</td><td class="py-3 px-6 text-center font-bold text-rose-500">${s.gagal}</td><td class="py-3 px-6 text-center font-mono text-slate-500">${sisa}</td><td class="py-3 px-6 text-right"><span class="px-2 py-1 bg-blue-50 text-blue-700 rounded-md font-bold text-xs">${rate}%</span></td></tr>`;
  }

  const canvasEl = document.getElementById("performanceChart");
  if (canvasEl) {
    const ctx = canvasEl.getContext("2d");
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Selesai (✅)",
            data: dataSelesai,
            backgroundColor: "#10b981",
            borderRadius: 4,
          },
          {
            label: "Gagal Kirim (❌)",
            data: dataGagal,
            backgroundColor: "#f43f5e",
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { min: 1, ticks: { stepSize: 1 }, grid: { color: "#f1f5f9" } },
          x: { grid: { display: false } },
        },
        plugins: {
          legend: {
            position: "top",
            labels: { usePointStyle: true, boxWidth: 8 },
          },
        },
      },
    });
  }
  renderAdminValidation();
}

function renderAdminValidation() {
  const tbody = document.getElementById("admin-validation-list");
  if (!tbody) return;
  tbody.innerHTML = "";
  let hasData = false;
  for (let user in dailyValidation) {
    for (let day in dailyValidation[user]) {
      hasData = true;
      let val = dailyValidation[user][day];
      let displayName =
        USERS[user] && USERS[user].name ? USERS[user].name : user.toUpperCase();
      let badge =
        val.status === "pending"
          ? '<span class="bg-amber-100 text-amber-700 px-2 py-1 rounded text-[10px] font-bold uppercase">Pending</span>'
          : '<span class="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-[10px] font-bold uppercase">Approved</span>';
      let actionBtn = "";
      if (val.status === "pending") {
        actionBtn = `<div class="flex gap-2 justify-center">
            <button onclick="approveValidation('${user}', ${day})" class="bg-emerald-500 hover:bg-emerald-600 text-white px-2 py-1.5 rounded-lg text-[10px] font-bold transition cursor-pointer shadow-sm" title="Setujui Saja">✓ Setujui</button>
            <button onclick="approveAndBypass('${user}', ${day})" class="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1.5 rounded-lg text-[10px] font-bold transition cursor-pointer shadow-sm" title="Setujui & Buka Waktu Tunggu">✓ Setujui & Bypass</button>
            <button onclick="rejectValidation('${user}', ${day})" class="bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-500 hover:text-white px-2 py-1.5 rounded-lg text-[10px] font-bold transition cursor-pointer">✕ Tolak</button>
        </div>`;
      } else {
        actionBtn = !val.isBypassed
          ? `<div class="flex gap-2 justify-center items-center"><span class="text-xs font-bold text-slate-400">Selesai</span><button onclick="bypassValidationTime('${user}', ${day})" class="bg-indigo-500 hover:bg-indigo-600 text-white px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer shadow-sm">Buka Akses</button></div>`
          : `<span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">Selesai & Waktu Terbuka</span>`;
      }
      tbody.innerHTML += `<tr class="hover:bg-indigo-50/30 transition-colors"><td class="py-3 px-6 font-bold text-slate-700 uppercase">${displayName} <span class="text-[10px] text-slate-400 normal-case">(ID: ${user})</span></td><td class="py-3 px-6 font-bold text-indigo-600">Hari ${day}</td><td class="py-3 px-6"><a href="${val.link}" target="_blank" class="text-blue-600 hover:underline hover:text-blue-800 text-xs font-mono break-all line-clamp-1 max-w-[250px]" title="${val.link}">👁️ Lihat Folder Upload</a></td><td class="py-3 px-6">${badge}</td><td class="py-3 px-6 text-center">${actionBtn}</td></tr>`;
    }
  }
  if (!hasData)
    tbody.innerHTML =
      '<tr><td colspan="5" class="py-6 text-center text-sm font-medium text-slate-400">Belum ada bukti tugas yang disubmit user.</td></tr>';
}

function approveValidation(user, day) {
  dailyValidation[user][day].status = "approved";
  dailyValidation[user][day].approvedAt = Date.now();
  saveValidation();
  showToast(`Tugas disetujui.`, "success");
}

function rejectValidation(user, day) {
  showDialog(
    "Tolak Validasi",
    `Tolak bukti tugas dari ${user.toUpperCase()}?`,
    "confirm",
    () => {
      delete dailyValidation[user][day];
      saveValidation();
      showToast("Ditolak.", "success");
    },
  );
}

function approveAndBypass(user, day) {
  dailyValidation[user][day].status = "approved";
  dailyValidation[user][day].approvedAt = Date.now();
  dailyValidation[user][day].isBypassed = true;
  saveValidation();
  showToast("Tugas disetujui & Akses Hari Berikutnya Terbuka.", "success");
}

function bypassValidationTime(user, day) {
  dailyValidation[user][day].isBypassed = true;
  saveValidation();
  showToast("Akses hari berikutnya berhasil dibuka secara paksa.", "success");
}

// --- WORKSPACE LOGIC (USER ONLY) ---
function renderTabs() {
  if (loggedInUser.role === "admin") return;
  const tabsContainer = document.getElementById("day-tabs");
  if (!tabsContainer) return;
  tabsContainer.innerHTML = "";
  let accessibleData = currentDB.filter(
    (d) => d.kodeUser === loggedInUser.username,
  );
  if (accessibleData.length === 0) return;

  let dailyData = accessibleData.filter(
    (d) => !d.taskType || d.taskType === "daily",
  );
  let emgData = accessibleData.filter((d) => d.taskType === "emergency");

  if (dailyData.length > 0) {
    const totalDays = Math.ceil(dailyData.length / ITEMS_PER_DAY) || 1;
    for (let i = 1; i <= totalDays; i++) {
      let isLocked = false,
        lockReason = "";

      if (i > 1) {
        let prevVal =
          dailyValidation[loggedInUser.username] &&
          dailyValidation[loggedInUser.username][i - 1]
            ? dailyValidation[loggedInUser.username][i - 1]
            : null;
        if (!prevVal || prevVal.status !== "approved") {
          isLocked = true;
          lockReason =
            "Peringatan: Tugas hari sebelumnya belum disetujui Admin.\nHarap tunggu persetujuan sebelum Anda dapat melanjutkan ke hari ini.";
        } else {
          let approvedTime = prevVal.approvedAt || Date.now();
          let targetDate = new Date(approvedTime);
          targetDate.setDate(targetDate.getDate() + 1);

          if (!WORK_ON_SUNDAY && targetDate.getDay() === 0)
            targetDate.setDate(targetDate.getDate() + 1);
          targetDate.setHours(7, 0, 0, 0);

          if (Date.now() < targetDate.getTime() && !prevVal.isBypassed) {
            isLocked = true;
            let liburTag =
              !WORK_ON_SUNDAY &&
              new Date(approvedTime + 86400000).getDay() === 0
                ? "\n(Sistem Libur Hari Minggu)"
                : "";
            lockReason = `Belum waktunya. Akses akan terbuka pada:\n${targetDate.toLocaleDateString("id-ID")} Pukul 07:00 Pagi.${liburTag}`;
          }
        }
      }

      const activeClass =
        i === activeDay
          ? "bg-blue-600 text-white shadow-md shadow-blue-500/30 transform scale-105 ring-2 ring-blue-600 ring-offset-2"
          : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-blue-600";
      const lockIcon = isLocked
        ? `<svg class="w-3.5 h-3.5 inline mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>`
        : "";
      const cursorClass = isLocked
        ? "cursor-not-allowed opacity-60"
        : "cursor-pointer";

      tabsContainer.innerHTML += `<button onclick="setDay(${i}, ${isLocked}, '${lockReason.replace(/\n/g, "\\n")}')" class="px-5 py-2 rounded-full font-bold text-xs shrink-0 transition-all duration-300 ${activeClass} ${cursorClass}">📅 Hari ${i} ${lockIcon}</button>`;
    }
  }

  if (Array.isArray(emgData) && emgData.length > 0) {
    let batches = [...new Set(emgData.map((d) => d.batchId))];
    batches.forEach((batch, idx) => {
      let emgId = `emg-${batch}`;
      let num = idx + 1;
      const isEmgActive = activeDay === emgId;
      const activeClass = isEmgActive
        ? "bg-rose-600 text-white shadow-md shadow-rose-500/30 transform scale-105 ring-2 ring-rose-600 ring-offset-2"
        : "bg-white border border-rose-200 text-rose-600 hover:bg-rose-50";
      tabsContainer.innerHTML += `<button onclick="setDay('${emgId}', false, '')" class="px-5 py-2 rounded-full font-bold text-xs shrink-0 transition-all duration-300 ${activeClass} cursor-pointer">🚨 Emergency ${num}</button>`;
    });
  }
}

function setDay(d, isLocked = false, reason = "") {
  if (isLocked) return showDialog("Akses Terkunci", reason, "alert");
  activeDay = d;
  renderTabs();
  renderTable();
}

function scrollToLastClicked() {
  let lastIdx =
    localStorage.getItem("ocm_last_interacted_idx") || currentOngoingIndex;
  if (lastIdx !== null && lastIdx !== undefined) {
    let activeRow = document.getElementById(`row-${lastIdx}`);
    if (activeRow) {
      activeRow.classList.add(
        "bg-indigo-50",
        "border-l-4",
        "border-indigo-500",
      );
      setTimeout(() => {
        activeRow.classList.remove(
          "bg-indigo-50",
          "border-l-4",
          "border-indigo-500",
        );
      }, 3000);
    }
  }
}

// [PERBAIKAN BUG]: renderTable sekarang merender nomor urut dan animasi kedalam HTML String secara langsung. Menghilangkan setTimeout DOM Manipulation yang bikin glitch.
function renderTable() {
  if (loggedInUser.role === "admin") return;
  const rowsContainer = document.getElementById("table-rows");
  const searchVal =
    document.getElementById("search-box")?.value.toLowerCase() || "";
  const noDataMsg = document.getElementById("no-data-msg");
  if (!rowsContainer) return;
  rowsContainer.innerHTML = "";

  let userSpecificData = currentDB
    .map((item, index) => ({ item, originalIndex: index }))
    .filter((d) => d.item.kodeUser === loggedInUser.username);

if (searchVal)
  userSpecificData = userSpecificData.filter(
    (d) =>
      d.item.nama.toLowerCase().includes(searchVal) ||
      d.item.kontrak.includes(searchVal) ||
      (d.item.hp && d.item.hp.toLowerCase().includes(searchVal)), // Fitur pencarian No. Telepon
  );

  let displayData = [];
  let isEmergency =
    typeof activeDay === "string" && activeDay.startsWith("emg-");

  if (isEmergency) {
    let batchId = activeDay.split("emg-")[1];
    displayData = userSpecificData.filter((d) => d.item.batchId === batchId);
  } else {
    let dailySpecificData = userSpecificData.filter(
      (d) => !d.item.taskType || d.item.taskType === "daily",
    );

    // PERBAIKAN: Jika ada pencarian, tampilkan semua hasil tanpa memotong berdasarkan hari
    if (searchVal) {
      displayData = dailySpecificData;
    } else {
      const startIndex = (activeDay - 1) * ITEMS_PER_DAY;
      displayData = dailySpecificData.slice(
        startIndex,
        startIndex + ITEMS_PER_DAY,
      );
    }
  }

  if (displayData.length === 0 && userSpecificData.length === 0) {
    if (noDataMsg) noDataMsg.classList.remove("hidden");
    syncOngoingPanel();
    checkDayCompletion([], false);
    return;
  }
  if (displayData.length === 0 && searchVal) {
    rowsContainer.innerHTML =
      '<tr><td colspan="6" class="text-center py-8 text-slate-400 bg-slate-50/50">Pencarian tidak ditemukan di tab ini.</td></tr>';
    return;
  }

  if (noDataMsg) noDataMsg.classList.add("hidden");
  let htmlContent = "";

  displayData.forEach((dataWrapper, idx) => {
    const data = dataWrapper.item;
    const origIdx = dataWrapper.originalIndex;

    let badgeStyle =
      data.status === "Proses"
        ? "bg-amber-100 text-amber-700 ring-1 ring-amber-200"
        : data.status === "Selesai"
          ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
          : data.status === "Gagal"
            ? "bg-rose-100 text-rose-700 ring-1 ring-rose-200"
            : "bg-slate-100 text-slate-500 ring-1 ring-slate-200";
    let ket = data.alasan
      ? `<span class="text-[10px] text-rose-500 bg-rose-50 px-2 py-1 rounded-md inline-block font-medium truncate max-w-[150px]">${data.alasan}</span>`
      : "-";
    let displayNumber = isEmergency
      ? idx + 1
      : (activeDay - 1) * ITEMS_PER_DAY + idx + 1;
// Tambahkan pengecekan apakah baris ini adalah tugas yang SEDANG berjalan (On Going)
let isOngoingRow = origIdx === currentOngoingIndex && data.status === "Proses";

let rowClass = isOngoingRow 
    ? "table-row-active shadow-sm" // Kelas CSS baru yang kita tambahkan di langkah 1
    : data.status === "Proses" 
        ? "bg-amber-50/30" 
        : isEmergency 
            ? "emergency-row hover:bg-slate-50" 
            : "hover:bg-blue-50/40 hover:shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] transition-all duration-200 group";

    // Inject langsung styling nomor (mengatasi glitch)
    let isOngoing = origIdx === currentOngoingIndex;
    let visualNumber = `
      <div class="relative overflow-hidden border px-3 py-1.5 rounded-lg inline-flex items-center justify-center font-bold min-w-[32px] group transition-all duration-300 ${isOngoing ? "bg-indigo-600 text-white border-indigo-600 shadow-md" : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200"}">
          <span class="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></span>
          <span class="relative z-10 text-xs">${displayNumber}</span>
      </div>`;

    htmlContent += `<tr id="row-${origIdx}" class="border-b border-slate-100 ${rowClass}">
            <td class="py-4 px-6 text-center">${visualNumber}</td>
            <td class="py-4 px-6 font-mono font-bold"><button onclick="triggerOngoing(${origIdx})" class="text-blue-600 bg-blue-50 px-2 py-1 rounded-lg hover:bg-blue-600 hover:text-white transition-all cursor-pointer shadow-sm" id="k-${origIdx}">${data.kontrak}</button></td>
            <td class="py-4 px-6 font-semibold text-slate-800">${data.nama} ${isEmergency ? '<span class="bg-rose-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md ml-1 shadow-sm">🚨 DARURAT</span>' : ""}</td>
            <td class="py-4 px-6">
                <div class="flex flex-col gap-1">
                    <span class="text-[9px] bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full w-max">${data.type}</span>
                    <span class="text-[12px] font-mono font-bold text-rose-600">${new Intl.NumberFormat("id-ID").format(data.sisa)}</span>
                </div>
            </td>
            <td class="py-4 px-6 text-center"><span class="text-[10px] px-3 py-1.5 rounded-full font-bold uppercase shadow-sm ${badgeStyle}">${data.status}</span></td>
            <td class="py-4 px-6">${ket}</td></tr>`;
  });

  rowsContainer.innerHTML = htmlContent;
  syncOngoingPanel();
  checkDayCompletion(displayData, isEmergency);
}

function checkDayCompletion(displayData, isEmergency) {
  const valPanel = document.getElementById("validation-panel");
  if (!valPanel) return;
  if (window.countdownInterval) clearInterval(window.countdownInterval);
  if (isEmergency || !displayData || displayData.length === 0) {
    valPanel.classList.add("hidden");
    return;
  }

  if (
    displayData.every(
      (d) => d.item.status === "Selesai" || d.item.status === "Gagal",
    )
  ) {
    valPanel.classList.remove("hidden");
    renderValidationPanel();
  } else {
    valPanel.classList.add("hidden");
  }
}

function renderValidationPanel() {
  const valPanel = document.getElementById("validation-panel");
  if (!valPanel) return;
  let currentDayVal = (dailyValidation[loggedInUser.username] || {})[activeDay];
  if (window.countdownInterval) clearInterval(window.countdownInterval);

  if (!currentDayVal) {
    valPanel.innerHTML = `
        <div class="flex flex-col md:flex-row gap-6 items-center">
            <div class="flex-1">
                <h3 class="text-lg font-bold text-indigo-900 mb-1">🎉 Tugas Hari ${activeDay} Selesai!</h3>
                <p class="text-xs text-indigo-700">Upload bukti kerja langsung ke folder Google Drive Anda secara manual.</p>
            </div>
            <div class="w-full md:w-[350px]">
                <button onclick="redirectToGDrive()" class="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold py-3.5 rounded-xl text-sm shadow-md cursor-pointer transition-colors flex items-center justify-center gap-2">
                    📁 Buka Google Drive & Submit
                </button>
            </div>
        </div>`;
  } else if (currentDayVal.status === "pending") {
    valPanel.innerHTML = `<div class="flex items-center gap-4 bg-white p-4 rounded-2xl border"><div class="spinner border-indigo-500 w-8 h-8"></div><div><h3 class="text-sm font-bold text-indigo-900">Menunggu Verifikasi</h3><p class="text-xs">Sistem mencatat Anda telah ke Google Drive. Menunggu persetujuan Admin.</p></div></div>`;
  } else {
    let approvedTime = currentDayVal.approvedAt || Date.now();
    let nextDayTarget = new Date(approvedTime);
    nextDayTarget.setDate(nextDayTarget.getDate() + 1);

    if (!WORK_ON_SUNDAY && nextDayTarget.getDay() === 0)
      nextDayTarget.setDate(nextDayTarget.getDate() + 1);
    nextDayTarget.setHours(7, 0, 0, 0);

    let now = Date.now();
    if (now < nextDayTarget.getTime() && !currentDayVal.isBypassed) {
      valPanel.innerHTML = `<div class="flex items-center gap-4 bg-emerald-50 p-4 rounded-2xl border"><div class="bg-emerald-500 text-white rounded-full p-1.5"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg></div><div class="flex-1"><h3 class="text-sm font-bold text-emerald-900">Disetujui!</h3><p class="text-xs text-emerald-800 mt-0.5">Tugas berikutnya terbuka dalam: <span id="realtime-countdown" class="font-mono font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-100 ml-1">Menghitung...</span></p></div></div>`;

      window.countdownInterval = setInterval(() => {
        let distance = nextDayTarget.getTime() - Date.now();
        if (distance < 0) {
          clearInterval(window.countdownInterval);
          renderTabs();
          renderValidationPanel();
        } else {
          let h = Math.floor(
            (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
          );
          let m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
          let s = Math.floor((distance % (1000 * 60)) / 1000);
          let el = document.getElementById("realtime-countdown");
          if (el) el.innerText = `${h}j ${m}m ${s}d`;
        }
      }, 1000);
    } else {
      valPanel.innerHTML = `<div class="flex items-center gap-4 bg-emerald-50 p-4 rounded-2xl border"><div class="bg-emerald-500 text-white rounded-full p-1.5"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg></div><div><h3 class="text-sm font-bold text-emerald-900">Disetujui!</h3><p class="text-xs">Silakan klik Tab Hari Berikutnya.</p></div></div>`;
    }
  }
}

function redirectToGDrive() {
  const userConfig = USERS[loggedInUser.username];
  const gdriveLink = userConfig ? userConfig.gdrive_upload_url : "";

  if (!gdriveLink || !gdriveLink.startsWith("http")) {
    return showDialog(
      "Link GDrive Kosong",
      "Admin belum mensetting Link Folder GDrive untuk akun Anda. Harap lapor ke Admin.",
      "alert",
    );
  }

  showDialog(
    "Panduan Upload Bukti",
    "Note: Ketika upload bukti kerja, tambah dulu folder format (Tgl Bulan Tahun) serta kelola akses di folder tersebut di ubah menjadi publik.",
    "confirm",
    () => {
      let nowHours = new Date().getHours();
      let isAutoApproveTime = nowHours >= 19 || nowHours < 7;
      let nextStatus = isAutoApproveTime ? "approved" : "pending";
      let approvedAtVal = nextStatus === "approved" ? Date.now() : null;

      if (!dailyValidation[loggedInUser.username])
        dailyValidation[loggedInUser.username] = {};
      dailyValidation[loggedInUser.username][activeDay] = {
        link: gdriveLink,
        status: nextStatus,
        approvedAt: approvedAtVal,
      };
      saveValidation();
      window.open(gdriveLink, "_blank");

      if (nextStatus === "approved")
        showToast(
          "Bukti tugas disubmit & Otomatis Disetujui (Melewati Jam Kerja Admin).",
          "success",
        );
      else
        showToast(
          "Bukti tugas disubmit. Menunggu verifikasi Admin.",
          "success",
        );

      renderValidationPanel();
      renderTabs();
    },
  );
}

// --- INTERAKSI ON GOING ---
// [PERBAIKAN BUG]: Mengunci logika agar status proses hanya berpindah pada database user login saja.
function triggerOngoing(index) {
  let updates = {};

  currentDB.forEach((item, idx) => {
    if (
      item.status === "Proses" &&
      idx !== index &&
      item.kodeUser === loggedInUser.username
    ) {
      item.status = "Belum";
      updates[`ocm_main_db/${idx}/status`] = "Belum";
    }
  });

  currentDB[index].status = "Proses";
  updates[`ocm_main_db/${index}/status`] = "Proses";

  currentOngoingIndex = index;
  localStorage.setItem("ocm_ongoing_idx", currentOngoingIndex);
  localStorage.setItem("ocm_last_interacted_idx", index);

  // Update secara spesifik, listener akan otomatis memanggil Render
  database.ref().update(updates);
}

function completeOngoing() {
  if (currentOngoingIndex !== null && currentDB[currentOngoingIndex]) {
    currentDB[currentOngoingIndex].status = "Selesai";
    currentDB[currentOngoingIndex].alasan = "";

    let updates = {};
    updates[`ocm_main_db/${currentOngoingIndex}/status`] = "Selesai";
    updates[`ocm_main_db/${currentOngoingIndex}/alasan`] = "";

    database.ref().update(updates);
    moveToNextContract();
  }
}

function syncOngoingPanel() {
  const emptyDiv = document.getElementById("ongoing-empty"),
    activeDiv = document.getElementById("ongoing-active");
  if (!emptyDiv || !activeDiv) return;

  if (
    currentOngoingIndex !== null &&
    currentDB[currentOngoingIndex] &&
    currentDB[currentOngoingIndex].status === "Proses"
  ) {
    const data = currentDB[currentOngoingIndex];

    if (
      loggedInUser.role === "user" &&
      data.kodeUser !== loggedInUser.username
    ) {
      emptyDiv.classList.remove("hidden");
      activeDiv.classList.add("hidden");
      return;
    }

    // Inject Data ke Panel Baru
    document.getElementById("og-kontrak").innerText = data.kontrak;
    document.getElementById("og-nama").innerText = data.nama;

    // Hapus teks "Tipe:" yang lama karena sudah ada labelnya di UI baru
    document.getElementById("og-type").innerText = data.type;

    document.getElementById("og-sisa").innerText = new Intl.NumberFormat(
      "id-ID",
    ).format(data.sisa);
    document.getElementById("og-hp").innerText = data.hp;

    // Switch view
    emptyDiv.classList.add("hidden");
    activeDiv.classList.remove("hidden");

    // Trigger ulang animasi slide-in jika panel aktif agar tidak kaku
    const animatedElements = activeDiv.querySelectorAll(".slide-in-right");
    animatedElements.forEach((el) => {
      el.style.animation = "none";
      el.offsetHeight; /* trigger reflow */
      el.style.animation = null;
    });
  } else {
    emptyDiv.classList.remove("hidden");
    activeDiv.classList.add("hidden");
  }
}

function dWAAman(jenis = "biasa") {
  let now = Date.now();
  let elapsed = now - lastWaTime;
  let requiredDelay = WA_DELAY * 1000;

  if (elapsed < requiredDelay) {
    let sisa = Math.ceil((requiredDelay - elapsed) / 1000);
    return showToast(
      `Anti-Spam: Tunggu ${sisa} detik lagi untuk kirim WA.`,
      "error",
    );
  }

  lastWaTime = now;
  let phoneNum = document.getElementById("og-hp").innerText.replace(/\D/g, "");
  if (phoneNum.startsWith("0")) phoneNum = "62" + phoneNum.substring(1);

  let consumerName = document.getElementById("og-nama").innerText.trim();
  let userName =
    USERS[loggedInUser.username]?.name || loggedInUser.username.toUpperCase();

  let userTemplates = USERS[loggedInUser.username]?.wa_templates || {};
  let defaultTemplate =
    "Halo ka, apakah benar ini dengan kk [nama_konsumen]? Saya [nama_user] dari FIFGroup.";
  let activeTemplate = defaultTemplate;

  let nowHours = new Date().getHours();
  if (nowHours >= 7 && nowHours < 10)
    activeTemplate = userTemplates.pagi || defaultTemplate;
  else if (nowHours >= 10 && nowHours < 14)
    activeTemplate = userTemplates.siang || defaultTemplate;
  else if (nowHours >= 14 && nowHours < 17)
    activeTemplate = userTemplates.sore || defaultTemplate;
  else
    activeTemplate =
      userTemplates.sore ||
      userTemplates.siang ||
      userTemplates.pagi ||
      defaultTemplate;

  let finalMessage = activeTemplate
    .replace(/\[nama_konsumen\]/gi, consumerName)
    .replace(/\[nama_user\]/gi, userName);
  let encodedMessage = encodeURIComponent(finalMessage);
  let isAndroid = /android/i.test(navigator.userAgent || navigator.vendor);

  if (isAndroid) {
    if (jenis === "business") {
      window.open(
        `intent://send?phone=${phoneNum}&text=${encodedMessage}#Intent;package=com.whatsapp.w4b;scheme=whatsapp;end`,
        "_blank",
      );
    } else {
      window.open(
        `intent://send?phone=${phoneNum}&text=${encodedMessage}#Intent;package=com.whatsapp;scheme=whatsapp;end`,
        "_blank",
      );
    }
  } else {
    window.open(`https://wa.me/${phoneNum}?text=${encodedMessage}`, "_blank");
  }
}

// --- UPLOAD EXCEL ---
function showSuccessModal(total, usr, typeLabel) {
  let displayName =
    USERS[usr] && USERS[usr].name ? USERS[usr].name : usr.toUpperCase();
  document.getElementById("succ-total-data").innerText = total + " Baris";
  document.getElementById("succ-target-user").innerText = displayName;
  document.getElementById("succ-task-type").innerText = typeLabel;
  document.getElementById("success-upload-modal").classList.remove("hidden");
  setTimeout(() => {
    document
      .getElementById("success-upload-modal")
      .classList.remove("opacity-0");
    document.getElementById("success-modal-box").classList.remove("scale-90");
  }, 10);
}

function closeSuccessModal() {
  document.getElementById("success-upload-modal").classList.add("opacity-0");
  document.getElementById("success-modal-box").classList.add("scale-90");
  setTimeout(
    () =>
      document.getElementById("success-upload-modal").classList.add("hidden"),
    300,
  );
}

// ==========================================
// FIX: FUNGSI UPLOAD EXCEL (processModalUpload)
// ==========================================
function processModalUpload() {
  const file = document.getElementById("modal-file-input").files[0];
  const targetUser = document.getElementById("admin-user-selector").value;
  const taskType = document.getElementById("upload-task-type").value;

  if (!file) return showToast("Pilih file!", "error");
  closeMasterSettingsModal();
  showLoading();

  setTimeout(() => {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        // defval: "" memastikan sel kosong terbaca sebagai string, bukan undefined
        const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        const emgBatchId = taskType === "emergency" ? Date.now().toString() : null;

        // 1. PERBAIKAN: Deteksi Kolom Excel yang Jauh Lebih Akurat
        let parsedData = jsonRows
          .map((row) => {
            let k = Object.keys(row);

            // Helper: Cari kecocokan persis dulu, baru kecocokan sebagian
            let findCol = (exactKeywords, partialKeyword, fallbackIndex) => {
              let exact = k.find(x => exactKeywords.includes(x.toUpperCase().trim()));
              if (exact) return exact;
              let partial = k.find(x => x.toUpperCase().includes(partialKeyword));
              return partial || k[fallbackIndex];
            };

            // Menargetkan kata kunci yang spesifik agar tidak salah ambil "Tgl Kontrak"
            let colKontrak = findCol(["KONTRAK", "NO KONTRAK", "NO. KONTRAK", "NOMOR KONTRAK"], "KONTRAK", 0);
            let colNama = findCol(["NAMA", "NAMA KONSUMEN", "NAMA PELANGGAN"], "NAMA", 1);
            let colHp = findCol(["HP", "NO HP", "NO. HP", "TELEPON", "NO TLP"], "HP", 2);
            let colType = findCol(["TYPE", "JENIS", "TIPE"], "TYPE", 3);
            let colSisa = findCol(["SISA", "SALDO", "SISA HUTANG"], "SISA", 4);

            return {
              kontrak: String(row[colKontrak] || "").trim(),
              nama: String(row[colNama] || "").trim().toUpperCase(),
              hp: String(row[colHp] || "").trim(),
              type: String(row[colType] || "-").trim().toUpperCase(),
              sisa: parseInt((row[colSisa] || "0").toString().replace(/\D/g, "")) || 0,
              kodeUser: targetUser,
              status: "Belum",
              alasan: "",
              taskType: taskType,
              batchId: emgBatchId,
            };
          })
          .filter((d) => d.kontrak !== "" && d.nama !== ""); // Filter baris kosong/rusak

        // 2. PERBAIKAN: Filter Duplikat Master Database
        let existingKontrak = new Set(currentDB.map((d) => String(d.kontrak).trim()));
        let newData = parsedData.filter((d) => !existingKontrak.has(d.kontrak));

        // Gabungkan data baru ke database yang sedang berjalan
        currentDB = currentDB.concat(newData);
        currentOngoingIndex = null;
        if (taskType === "daily") activeDay = 1;
        else activeDay = `emg-${emgBatchId}`;

        saveState();
        hideLoading();

        // 3. PERBAIKAN: Dialog Konfirmasi Jika Ada Data Duplikat
        let duplicateCount = parsedData.length - newData.length;
        if (duplicateCount > 0) {
          showDialog(
            "Upload Selesai (Ada Duplikat)",
            `Berhasil memproses Excel.\n\n📊 Total Data Excel: ${parsedData.length} baris\n✅ Data Baru Masuk: ${newData.length} baris\n⚠️ Data Diabaikan: ${duplicateCount} baris (Sudah ada di database sebelumnya berdasarkan No. Kontrak).\n\nSistem mengabaikan data duplikat untuk mencegah bentrok tugas.`,
            "alert",
            () => {
                showSuccessModal(
                  newData.length,
                  targetUser,
                  taskType === "emergency" ? "🚨 Emergency" : "📅 Harian Normal"
                );
            }
          );
        } else {
          showSuccessModal(
            parsedData.length,
            targetUser,
            taskType === "emergency" ? "🚨 Emergency" : "📅 Harian Normal"
          );
        }
      } catch (err) {
        hideLoading();
        showDialog("Error Ekstrak", "Gagal memproses file Excel. Pastikan format tabel sudah benar.\n\nDetail: " + err.message, "alert");
      }
    };
    reader.readAsArrayBuffer(file);
  }, 400);
}

// --- SISTEM GAGAL ---
function openFailModal() {
  document.getElementById("fail-modal").classList.remove("hidden");
  setTimeout(() => {
    document.getElementById("fail-modal").classList.remove("opacity-0");
    document.getElementById("fail-modal-box").classList.remove("scale-90");
  }, 10);
}
function closeFailModal() {
  document.getElementById("fail-modal").classList.add("opacity-0");
  document.getElementById("fail-modal-box").classList.add("scale-90");
  setTimeout(
    () => document.getElementById("fail-modal").classList.add("hidden"),
    300,
  );
}
function submitFail() {
  let alasan = document.getElementById("fail-reason").value;
  if (!alasan) return showToast("Pilih alasan gagal!", "error");

  if (currentOngoingIndex !== null && currentDB[currentOngoingIndex]) {
    currentDB[currentOngoingIndex].status = "Gagal";
    currentDB[currentOngoingIndex].alasan = alasan;

    let updates = {};
    updates[`ocm_main_db/${currentOngoingIndex}/status`] = "Gagal";
    updates[`ocm_main_db/${currentOngoingIndex}/alasan`] = alasan;

    database.ref().update(updates);
    closeFailModal();
    moveToNextContract();
  }
}

function clearData() {
  if (loggedInUser.role !== "admin") return;
  const selectedUser = document.getElementById("clear-db-user-select").value;
  if (!selectedUser) return showToast("Pilih user.", "error");
  showDialog(
    "Hapus Data",
    `⚠️ PERINGATAN KRITIS\n\nYakin hapus data untuk: ${selectedUser.toUpperCase()}?`,
    "confirm",
    () => {
      if (selectedUser === "all") {
        currentDB = [];
        dailyValidation = {};
      } else {
        currentDB = currentDB.filter((d) => d.kodeUser !== selectedUser);
        delete dailyValidation[selectedUser];
      }
      currentOngoingIndex = null;
      saveState();
      saveValidation();
      showToast(`Data dibersihkan!`, "success");
    },
  );
}

function saveAdminCredentials() {
  const newUser = document
    .getElementById("edit-admin-user")
    .value.trim()
    .toLowerCase();
  const newPass = document.getElementById("edit-admin-pass").value.trim();
  const newName = document.getElementById("edit-admin-name").value.trim();
  const photoInput = document.getElementById("edit-admin-photo");
  const oldUser = loggedInUser.username;

  if (!newUser || !newPass)
    return showToast("Username dan Password tidak boleh kosong!", "error");
  if (newUser !== oldUser && USERS[newUser])
    return showToast("Username sudah dipakai user lain!", "error");

  let saveToDB = (photoBase64) => {
    showDialog(
      "Simpan Kredensial?",
      "Anda yakin ingin mengubah data Kredensial Admin?",
      "confirm",
      () => {
        let adminData = USERS[oldUser] || { role: "admin" };
        adminData.pass = newPass;
        if (newName) adminData.name = newName;
        if (photoBase64 !== undefined) adminData.photo = photoBase64;

        if (newUser !== oldUser) {
          currentDB.forEach((d) => {
            if (d.kodeUser === oldUser) d.kodeUser = newUser;
          });
          saveState();
          USERS[newUser] = adminData;
          delete USERS[oldUser];
          loggedInUser.username = newUser;
          sessionStorage.setItem("ocm_session", JSON.stringify(loggedInUser));
          document.getElementById("display-username").innerText = newUser;
        } else {
          USERS[oldUser] = adminData;
        }

        saveUsers();
        closeMasterSettingsModal();
        showToast("Kredensial Admin berhasil diperbarui!", "success");
        initApp();
      },
    );
  };

  if (photoInput.files && photoInput.files[0]) {
    showLoading();
    const reader = new FileReader();
    reader.onload = function (e) {
      hideLoading();
      saveToDB(e.target.result);
    };
    reader.readAsDataURL(photoInput.files[0]);
  } else {
    saveToDB(undefined);
  }
}

function saveSystemSettings() {
  let newVal = parseInt(document.getElementById("setting-items-per-day").value);
  let newDelay = parseInt(document.getElementById("setting-wa-delay").value);
  let isMinggu = document.getElementById("setting-minggu-kerja").checked;

  if (isNaN(newVal) || newVal < 1)
    return showToast("Masukkan angka limit yang valid!", "error");
  if (isNaN(newDelay) || newDelay < 0)
    return showToast("Masukkan angka jeda WA yang valid!", "error");

  showDialog(
    "Simpan Pengaturan?",
    `Perbarui batasan harian, jeda WA, template WA, dan pengaturan kerja Minggu?`,
    "confirm",
    () => {
      database.ref("ocm_settings").update({
        items_per_day: newVal,
        wa_delay: newDelay,
        work_on_sunday: isMinggu,
      });
      showToast("Pengaturan berhasil diperbarui!", "success");
      if (loggedInUser && loggedInUser.role !== "admin") {
        renderTabs();
        renderTable();
      }
    },
  );
}

function renderEformBuilderList() {
  const list = document.getElementById("eform-builder-list");
  if (!list) return;
  list.innerHTML = "";
  let fields =
    EFORM_SETTINGS && EFORM_SETTINGS.length > 0
      ? EFORM_SETTINGS
      : defaultEformFields;

  fields.forEach((field, index) => {
    list.innerHTML += `<div class="flex justify-between items-center bg-white p-2 border border-slate-200 rounded-lg"><div><span class="text-xs font-bold text-slate-800">${field.label}</span><span class="text-[10px] text-slate-500 ml-2 bg-slate-100 px-1 rounded uppercase">${field.type}</span></div><button onclick="removeEformField(${index})" class="text-rose-500 hover:text-rose-700 font-bold text-[10px]">Hapus</button></div>`;
  });
}

function renderAdminEformSubmissions() {
  const tbody = document.getElementById("admin-eform-submissions");
  if (!tbody) return;
  tbody.innerHTML = "";
  let hasData = false;

  for (let key in PENGAJUAN_PINJAMAN) {
    hasData = true;
    let sub = PENGAJUAN_PINJAMAN[key];
    let detailHtml = `<span class="block text-xs mb-1"><strong class="text-slate-600">CS ID:</strong> <span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase">${sub.cs_id || "Tanpa CS"}</span></span><span class="block text-xs"><strong class="text-slate-600">Nominal:</strong> Rp ${new Intl.NumberFormat("id-ID").format(sub.nominal_pengajuan || 0)}</span><span class="block text-xs"><strong class="text-slate-600">No HP:</strong> ${sub.no_hp || "-"}</span><span class="block text-xs"><strong class="text-slate-600">TTL:</strong> ${sub.tempat_lahir || "-"}, ${sub.tgl_lahir || "-"}</span><span class="block text-xs"><strong class="text-slate-600">Alamat:</strong> ${sub.alamat || "-"}</span><span class="block text-xs"><strong class="text-slate-600">BPKB:</strong> ${sub.status_bpkb || "-"}</span>`;
    let kontrakInput = sub.kontrakAdmin
      ? `<span class="font-bold text-emerald-600">${sub.kontrakAdmin}</span>`
      : `<div class="flex gap-1"><input type="text" id="kontrak-${key}" class="w-full text-xs p-1.5 border border-slate-200 rounded outline-none" placeholder="Input Kontrak..."><button onclick="saveKontrakEform('${key}')" class="bg-blue-600 hover:bg-blue-700 text-white text-[10px] px-2 rounded cursor-pointer transition">Simpan</button></div>`;
    tbody.innerHTML += `<tr class="hover:bg-slate-50 transition-colors"><td class="py-3 px-6"><span class="font-bold text-slate-800">${sub.nama || "Tanpa Nama"}</span><br><span class="text-[10px] text-slate-500">${sub.tanggal_masuk || "-"}</span></td><td class="py-3 px-6 space-y-1">${detailHtml}</td><td class="py-3 px-6">${kontrakInput}</td></tr>`;
  }
  if (!hasData)
    tbody.innerHTML =
      '<tr><td colspan="3" class="text-center py-6 text-slate-500 text-sm">Belum ada pengajuan dana tunai yang masuk.</td></tr>';
}

setTimeout(() => {
  if (document.getElementById("initial-loading-screen") && !isDataLoaded) {
    matikanLoadingAwal();
    if (typeof showExcelToast === "function")
      showExcelToast(
        "Koneksi Lambat",
        "Dashboard dimuat menggunakan cache.",
        "error",
      );
  }
}, 8000);

function listenPengajuanEform() {
  firebase
    .database()
    .ref("pengajuan_pinjaman")
    .on(
      "value",
      (snapshot) => {
        if (typeof matikanLoadingAwal === "function") matikanLoadingAwal();
        if (typeof renderAdminEformSubmissions === "function") {
          renderAdminEformSubmissions(snapshot.val());
        } else {
          const tbody = document.getElementById("table-body-pengajuan");
          if (!tbody) return;
          tbody.innerHTML = "";

          if (!snapshot.exists()) {
            tbody.innerHTML =
              '<tr><td colspan="10" class="text-center py-6 text-slate-500 text-sm font-medium">Belum ada pengajuan dana tunai yang masuk bulan ini.</td></tr>';
            return;
          }

          const data = snapshot.val();
          let hasData = false;
          Object.keys(data).forEach((key) => {
            hasData = true;
            let sub = data[key];
            let row = `<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors"><td class="py-3 px-4"><span class="block text-xs mb-1"><strong class="text-slate-600">CS ID:</strong> <span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase">${sub.cs_id || "Tanpa CS"}</span></span><span class="block text-xs"><strong class="text-slate-600">Nama:</strong> ${sub.nama || "-"}</span><span class="block text-xs"><strong class="text-slate-600">Nominal:</strong> Rp ${new Intl.NumberFormat("id-ID").format(sub.nominal_pengajuan || 0)}</span><span class="block text-xs"><strong class="text-slate-600">No HP:</strong> ${sub.no_hp || "-"}</span><span class="block text-xs"><strong class="text-slate-600">TTL:</strong> ${sub.tempat_lahir || "-"}, ${sub.tgl_lahir || "-"}</span><span class="block text-xs"><strong class="text-slate-600">Alamat:</strong> ${sub.alamat || "-"}</span><span class="block text-xs"><strong class="text-slate-600">BPKB:</strong> ${sub.status_bpkb || "-"}</span></td><td class="py-3 px-4 text-center"><input type="text" id="kontrak-${key}" value="${sub.kontrakAdmin || ""}" placeholder="Input No. Kontrak" class="border border-slate-300 rounded px-2 py-1 text-xs w-full mb-2"><button onclick="saveKontrakEform('${key}')" class="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] px-3 py-1 rounded shadow cursor-pointer w-full">Simpan Kontrak</button></td></tr>`;
            tbody.insertAdjacentHTML("afterbegin", row);
          });
          if (!hasData)
            tbody.innerHTML =
              '<tr><td colspan="10" class="text-center py-6 text-slate-500 text-sm font-medium">Belum ada pengajuan dana tunai yang masuk bulan ini.</td></tr>';
        }
      },
      (error) => {
        if (typeof matikanLoadingAwal === "function") matikanLoadingAwal();
        alert("Gagal memuat data dari server: " + error.message);
      },
    );
}

document.addEventListener("DOMContentLoaded", () => {
  listenPengajuanEform();
});

function saveKontrakEform(key) {
  let val = document.getElementById(`kontrak-${key}`).value.trim();
  if (!val)
    return showToast
      ? showToast("Isi nomor kontrak terlebih dahulu!", "error")
      : alert("Isi nomor kontrak!");

  database
    .ref(`pengajuan_pinjaman/${key}/kontrakAdmin`)
    .set(val)
    .then(() => {
      if (typeof showToast === "function")
        showToast("Kontrak berhasil disimpan!", "success");
      else alert("Kontrak berhasil disimpan!");
    })
    .catch((err) => {
      alert("Gagal menyimpan: " + err.message);
    });
}

function simpanPengajuanManual(dataPengajuan) {
  let isResolved = false;
  let loadingEl = document.getElementById("loading-screen");
  if (loadingEl) loadingEl.classList.remove("hidden");

  firebase
    .database()
    .ref("pengajuan_masuk")
    .push(dataPengajuan)
    .then(() => {
      isResolved = true;
      if (loadingEl) loadingEl.classList.add("hidden");
      if (typeof showToast === "function")
        showToast("Pengajuan berhasil ditambahkan.", "success");
    })
    .catch((error) => {
      isResolved = true;
      if (loadingEl) loadingEl.classList.add("hidden");
      alert("Error: " + error.message);
    });

  setTimeout(() => {
    if (!isResolved) {
      if (loadingEl) loadingEl.classList.add("hidden");
      alert(
        "Waktu koneksi habis. Silakan periksa koneksi internet Anda dan coba lagi.",
      );
    }
  }, 10000);
}

function recapMonthlyData() {
  const modal = document.getElementById("recap-confirm-modal");
  modal.classList.remove("hidden");
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modal.firstElementChild.classList.remove("scale-95");
  }, 20);
}

function closeRecapModal() {
  const modal = document.getElementById("recap-confirm-modal");
  modal.classList.add("opacity-0");
  modal.firstElementChild.classList.add("scale-95");
  setTimeout(() => {
    modal.classList.add("hidden");
  }, 300);
}

function executeRecapAndReset() {
  closeRecapModal();
  if (document.getElementById("loading-screen"))
    document.getElementById("loading-screen").classList.remove("hidden");

  const monthNames = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  const now = new Date();
  const currentMonth = monthNames[now.getMonth()] + " " + now.getFullYear();
  const recapId = "rekap_" + now.getTime();

  firebase
    .database()
    .ref("pengajuan_pinjaman")
    .once("value")
    .then((snapshot) => {
      if (!snapshot.exists()) {
        if (document.getElementById("loading-screen"))
          document.getElementById("loading-screen").classList.add("hidden");
        showExcelToast(
          "Gagal",
          "Tabel kosong, tidak ada data untuk direkap.",
          "error",
        );
        return Promise.reject("empty");
      }
      return firebase
        .database()
        .ref(`rekapan_pengajuan/${recapId}`)
        .set({
          periode: currentMonth,
          tanggal_rekap: now.toLocaleString("id-ID"),
          data: snapshot.val(),
        });
    })
    .then(() => firebase.database().ref("pengajuan_pinjaman").remove())
    .then(() => {
      if (document.getElementById("loading-screen"))
        document.getElementById("loading-screen").classList.add("hidden");
      showExcelToast(
        "Berhasil!",
        `Data periode ${currentMonth} diarsipkan.`,
        "success",
      );
      if (typeof loadRecapData === "function") loadRecapData();
    })
    .catch((error) => {
      if (error === "empty") return;
      if (document.getElementById("loading-screen"))
        document.getElementById("loading-screen").classList.add("hidden");
      showExcelToast("Error", error.message || error, "error");
    });
}

function loadRecapData() {
  firebase
    .database()
    .ref("rekapan_pengajuan")
    .on("value", (snapshot) => {
      const container = document.getElementById("recap-list-container");
      if (!container) return;
      container.innerHTML = "";
      if (!snapshot.exists()) {
        container.innerHTML =
          '<p class="text-sm text-slate-500 italic text-center py-4">Belum ada arsip rekapan tersedia.</p>';
        return;
      }

      const recaps = snapshot.val();
      Object.keys(recaps)
        .reverse()
        .forEach((key) => {
          let item = recaps[key];
          let totalData = item.data ? Object.keys(item.data).length : 0;
          let div = document.createElement("div");
          div.className =
            "bg-white p-4 border border-indigo-200 rounded-xl flex justify-between items-center shadow-sm hover:shadow-md transition-shadow";
          div.innerHTML = `<div><h5 class="font-bold text-slate-800 text-sm">Rekapan ${item.periode}</h5><p class="text-[10px] text-slate-500 mt-0.5">Tanggal Reset: ${item.tanggal_rekap} • ${totalData} Pengajuan</p></div><button onclick="downloadModernExcel('${key}')" class="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer">📥 Download Excel</button>`;
          container.appendChild(div);
        });
    });
}

function showExcelToast(title, desc, status) {
  const toast = document.getElementById("excel-toast");
  const iconBox = document.getElementById("excel-toast-icon");
  if (!toast || !iconBox) return;

  document.getElementById("excel-toast-title").innerText = title;
  document.getElementById("excel-toast-desc").innerText = desc;

  if (status === "loading") {
    iconBox.className =
      "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-amber-50 text-amber-600";
    iconBox.innerHTML = `<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
  } else if (status === "success") {
    iconBox.className =
      "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-emerald-50 text-emerald-600";
    iconBox.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>`;
  } else if (status === "error") {
    iconBox.className =
      "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-rose-50 text-rose-600";
    iconBox.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>`;
  }

  toast.classList.remove("translate-y-24", "opacity-0");
  toast.classList.add("translate-y-0", "opacity-100");
  if (status !== "loading") {
    setTimeout(() => {
      toast.classList.remove("translate-y-0", "opacity-100");
      toast.classList.add("translate-y-24", "opacity-0");
    }, 3500);
  }
}

function downloadModernExcel(recapId) {
  showExcelToast(
    "Mengunduh...",
    "Mengumpulkan data arsip dari cloud...",
    "loading",
  );
  firebase
    .database()
    .ref(`rekapan_pengajuan/${recapId}`)
    .once("value")
    .then((snapshot) => {
      if (!snapshot.exists()) {
        showExcelToast("Gagal Unduh", "Arsip data tidak ditemukan.", "error");
        return;
      }

      let recapData = snapshot.val();
      let rawData = recapData.data;
      let periode = recapData.periode;
      let excelRows = [
        [
          "ID Database",
          "Tanggal Masuk",
          "CS ID",
          "Nama Nasabah",
          "No. HP/WA",
          "Plafon Dana",
          "BPKB",
          "No. Kontrak Admin",
          "Tempat Lahir",
          "Tgl Lahir",
          "Alamat",
        ],
      ];

      Object.keys(rawData).forEach((dataKey) => {
        let d = rawData[dataKey];
        excelRows.push([
          dataKey,
          d.tanggal_masuk || "-",
          d.cs_id || "Tanpa CS",
          d.nama || "-",
          d.no_hp || "-",
          d.nominal_pengajuan
            ? `Rp ${parseInt(d.nominal_pengajuan).toLocaleString("id-ID")}`
            : "-",
          d.status_bpkb || "-",
          d.kontrakAdmin || "Belum Diinput",
          d.tempat_lahir || "-",
          d.tgl_lahir || "-",
          d.alamat || "-",
        ]);
      });

      let ws = XLSX.utils.aoa_to_sheet(excelRows);
      ws["!cols"] = [
        { wch: 22 },
        { wch: 20 },
        { wch: 15 },
        { wch: 25 },
        { wch: 18 },
        { wch: 18 },
        { wch: 12 },
        { wch: 22 },
        { wch: 18 },
        { wch: 15 },
        { wch: 50 },
      ];
      let wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Rekap " + periode);

      XLSX.writeFile(
        wb,
        `Laporan_Pengajuan_${periode.replace(/\s+/g, "_")}.xlsx`,
      );
      setTimeout(() => {
        showExcelToast(
          "Berhasil Diunduh!",
          "File Excel siap digunakan.",
          "success",
        );
      }, 500);
    })
    .catch((err) => {
      showExcelToast("Gagal Sistem", err.message, "error");
    });
}

function escapeHTML(str) {
  if (!str) return "";
  return str.replace(
    /[&<>'"]/g,
    (tag) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[tag] || tag,
  );
}

// [PERBAIKAN BUG KONTRAK LANJUTAN]:
// Melacak kontrak belum selesai, memvalidasi kepemilikan akun, DAN memastikan
// kontrak berikutnya tidak melompat ke hari/tab (batas ITEMS_PER_DAY) yang belum dibuka.
function moveToNextContract() {
  if (currentOngoingIndex === null) return;

  let nextIndex = currentOngoingIndex + 1;
  let foundTarget = false;

  // Deteksi apakah sedang berada di tab Emergency atau Daily
  let isEmergency =
    typeof activeDay === "string" && activeDay.startsWith("emg-");

  // Siapkan batas index data untuk Hari yang sedang aktif
  let userSpecificData = currentDB
    .map((item, index) => ({ item, originalIndex: index }))
    .filter((d) => d.item.kodeUser === loggedInUser.username);

  let dailySpecificData = userSpecificData.filter(
    (d) => !d.item.taskType || d.item.taskType === "daily",
  );

  // Kalkulasi limit index hari ini (berdasarkan perhitungan ITEMS_PER_DAY)
  let allowedStartIndex = (activeDay - 1) * ITEMS_PER_DAY;
  let allowedEndIndex = allowedStartIndex + ITEMS_PER_DAY - 1;
  let emgBatchId = isEmergency ? activeDay.split("emg-")[1] : null;

  // Mencari data yang Belum atau Proses di dalam array Utama
  while (nextIndex < currentDB.length) {
    let item = currentDB[nextIndex];

    if (
      item &&
      item.kodeUser === loggedInUser.username &&
      item.status !== "Selesai" &&
      item.status !== "Gagal"
    ) {
      // CEK BATAS HARI: Pastikan kontrak tidak melompat ke hari berikutnya
      let isAllowedInCurrentTab = false;

      if (isEmergency) {
        isAllowedInCurrentTab = item.batchId === emgBatchId;
      } else {
        if (!item.taskType || item.taskType === "daily") {
          // Cari urutan ke berapa item ini di seluruh data harian user
          let itemDailyIndex = dailySpecificData.findIndex(
            (d) => d.originalIndex === nextIndex,
          );

          // Izinkan jika index masih masuk dalam porsi tab hari ini
          if (
            itemDailyIndex >= allowedStartIndex &&
            itemDailyIndex <= allowedEndIndex
          ) {
            isAllowedInCurrentTab = true;
          }
        }
      }

      if (isAllowedInCurrentTab) {
        foundTarget = true;
        break;
      } else {
        // Jika masuk ke kondisi ini, berarti item berstatus Belum/Proses selanjutnya
        // sudah berada di tab hari esok atau batch berbeda. HENTIKAN pencarian.
        break;
      }
    }
    nextIndex++;
  }

  if (foundTarget) {
    // Memanggil fungsi eksekusi OnGoing yang sah
    triggerOngoing(nextIndex);

    // Animasi Gulir Otomatis Ke Kontrak Baru Tersebut
    setTimeout(() => {
      let nextRow = document.getElementById(`row-${nextIndex}`);
      if (nextRow) {
        let tableContainer = nextRow.closest("div");
        if (tableContainer) {
          tableContainer.classList.add(
            "overflow-y-auto",
            "max-h-[60vh]",
            "custom-scrollbar",
          );
          let rowOffsetTop = nextRow.offsetTop;
          tableContainer.scrollTo({
            top:
              rowOffsetTop -
              tableContainer.clientHeight / 2 +
              nextRow.clientHeight / 2,
            behavior: "smooth",
          });
        }

        // === AKTIFKAN ANIMASI TRANSISI DRAMATIS KONTRAK BARU ===
        nextRow.classList.add(
          "bg-indigo-100", // Flash warna background lebih terang
          "scale-[1.02]", // Sedikit membesar keluar dari baris
          "ring-4", // Efek border luar bulat (Glow)
          "ring-indigo-500/40", // Warna glow indigo transparan
          "transition-all",
          "duration-500", // Durasi masuk animasi
          "shadow-xl", // Bayangan tebal memberi efek melayang
          "z-10",
          "relative",
        );

        // Kembalikan baris ke kondisi normal secara halus (Fade-out effect)
        setTimeout(() => {
          nextRow.classList.remove(
            "scale-[1.02]",
            "ring-4",
            "ring-indigo-500/40",
            "shadow-xl",
          );
          nextRow.classList.replace("bg-indigo-100", "bg-indigo-50");
          nextRow.classList.add("duration-700");
        }, 1000);
      }
    }, 150);
  } else {
    // Jika tidak ada lagi target di hari INI, matikan auto-select dan render ulang
    currentOngoingIndex = null;
    localStorage.removeItem("ocm_ongoing_idx");
    if (typeof syncOngoingPanel === "function") syncOngoingPanel();
    renderTable();
    showToast(
      "Semua data pengajuan di tab hari ini telah selesai diproses!",
      "success",
    );
  }
}

// Sisi Web (JavaScript) - Logika Pengambilan Data
async function loadAppData() {
  // 1. Cek apakah master data sudah ada di lokal
  let masterData = localStorage.getItem("masterDatabase");

  if (!masterData) {
    // Jika belum ada, ambil SEMUA data dari database server (Hanya terjadi 1x)
    const response = await fetch("/api/get_all_data");
    masterData = await response.json();
    localStorage.setItem("masterDatabase", JSON.stringify(masterData));
    console.log("Database utama berhasil didownload & disimpan.");
  } else {
    masterData = JSON.parse(masterData);
    console.log("Memuat database dari penyimpanan lokal.");
  }

  // 2. Selalu update/ambil data status kemajuan terbaru
  updateStatusKemajuan();
}

async function updateStatusKemajuan() {
  // Mengambil data ringan yang isinya cuma status saja
  const response = await fetch("/api/get_status_kemajuan");
  const statusData = await response.json();

  // Terapkan statusData ke elemen UI di layar
  document.getElementById("progress-status").innerText = statusData.status_text;
}

// --- SISTEM PENGUMUMAN ADMIN ---
function kirimNotifikasiAdmin() {
  // Kosongkan form saat dibuka
  document.getElementById("input-notif-msg").value = "";

  // Buka modal
  const modal = document.getElementById("modern-notif-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  setTimeout(() => {
    modal.classList.remove("opacity-0");
  }, 10);
}

function closeNotifModal() {
  const modal = document.getElementById("modern-notif-modal");
  modal.classList.add("opacity-0");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 300);
}
