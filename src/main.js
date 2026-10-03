const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;

const statusbar = document.getElementById("statusbar");
function setStatus(msg) {
  statusbar.textContent = msg;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add("active");
  });
});

// ---------- Rangement ----------
const organizePathEl = document.getElementById("organize-path");
const organizePickBtn = document.getElementById("organize-pick");
const organizePreviewBtn = document.getElementById("organize-preview");
const organizeRunBtn = document.getElementById("organize-run");
const organizeResultEl = document.getElementById("organize-result");
let organizeFolder = null;

organizePickBtn.addEventListener("click", async () => {
  const selected = await open({ directory: true, multiple: false });
  if (!selected) return;
  organizeFolder = selected;
  organizePathEl.value = selected;
  organizePreviewBtn.disabled = false;
  organizeRunBtn.disabled = false;
  organizeResultEl.textContent = "";
});

organizePreviewBtn.addEventListener("click", async () => {
  if (!organizeFolder) return;
  setStatus("Analyse du dossier…");
  try {
    const moves = await invoke("preview_organize", { folder: organizeFolder });
    if (moves.length === 0) {
      organizeResultEl.textContent = "Aucun fichier à ranger à la racine de ce dossier.";
    } else {
      const counts = {};
      moves.forEach((m) => (counts[m.category] = (counts[m.category] || 0) + 1));
      const lines = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, n]) => `${cat} : ${n} fichier(s)`);
      organizeResultEl.textContent = `Aperçu (${moves.length} fichier(s)) :\n` + lines.join("\n");
    }
    setStatus("Aperçu généré.");
  } catch (e) {
    organizeResultEl.textContent = `Erreur : ${e}`;
    setStatus("Erreur.");
  }
});

organizeRunBtn.addEventListener("click", async () => {
  if (!organizeFolder) return;
  setStatus("Rangement en cours…");
  try {
    const res = await invoke("organize_folder", { folder: organizeFolder });
    const lines = res.counts.map(([cat, n]) => `${cat} : ${n} fichier(s)`);
    organizeResultEl.textContent =
      `${res.moves.length} fichier(s) rangé(s) :\n` + lines.join("\n");
    setStatus("Rangement terminé.");
  } catch (e) {
    organizeResultEl.textContent = `Erreur : ${e}`;
    setStatus("Erreur.");
  }
});

// ---------- Nettoyage ----------
const cacheScanBtn = document.getElementById("cache-scan");
const cacheCleanBtn = document.getElementById("cache-clean");
const cacheListEl = document.getElementById("cache-list");
const cacheResultEl = document.getElementById("cache-result");
let cacheEntries = [];

cacheScanBtn.addEventListener("click", async () => {
  setStatus("Scan des caches…");
  cacheResultEl.textContent = "";
  try {
    cacheEntries = await invoke("scan_caches");
    renderCacheList();
    setStatus("Scan terminé.");
  } catch (e) {
    cacheResultEl.textContent = `Erreur : ${e}`;
    setStatus("Erreur.");
  }
});

function renderCacheList() {
  cacheListEl.innerHTML = "";
  const existing = cacheEntries.filter((e) => e.exists && e.size_bytes > 0);
  if (existing.length === 0) {
    cacheListEl.innerHTML = '<div class="empty-state">Rien à nettoyer pour le moment.</div>';
    cacheCleanBtn.disabled = true;
    return;
  }
  const maxSize = Math.max(...existing.map((e) => e.size_bytes));
  existing.forEach((entry) => {
    const row = document.createElement("label");
    row.className = "list-item";
    row.innerHTML = `
      <input type="checkbox" data-path="${entry.path}" />
      <div class="meta">
        <div class="name">${entry.label}</div>
        <div class="sub">${entry.path}</div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${(entry.size_bytes / maxSize) * 100}%"></div></div>
      <div class="size">${formatBytes(entry.size_bytes)}</div>
    `;
    cacheListEl.appendChild(row);
  });
  updateCacheCleanState();
  cacheListEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", updateCacheCleanState);
  });
}

function updateCacheCleanState() {
  const checked = cacheListEl.querySelectorAll("input[type=checkbox]:checked");
  cacheCleanBtn.disabled = checked.length === 0;
}

cacheCleanBtn.addEventListener("click", async () => {
  const checked = [...cacheListEl.querySelectorAll("input[type=checkbox]:checked")].map(
    (cb) => cb.dataset.path
  );
  if (checked.length === 0) return;
  setStatus("Nettoyage en cours…");
  try {
    const res = await invoke("clean_caches", { paths: checked });
    cacheResultEl.textContent = `${formatBytes(res.freed_bytes)} libéré(s).` +
      (res.errors.length ? `\n${res.errors.length} erreur(s).` : "");
    setStatus("Nettoyage terminé.");
    cacheScanBtn.click();
  } catch (e) {
    cacheResultEl.textContent = `Erreur : ${e}`;
    setStatus("Erreur.");
  }
});

// ---------- Doublons ----------
const dupPathEl = document.getElementById("dup-path");
const dupPickBtn = document.getElementById("dup-pick");
const dupScanBtn = document.getElementById("dup-scan");
const dupDeleteBtn = document.getElementById("dup-delete");
const dupListEl = document.getElementById("dup-list");
const dupResultEl = document.getElementById("dup-result");
let dupFolder = null;

dupPickBtn.addEventListener("click", async () => {
  const selected = await open({ directory: true, multiple: false });
  if (!selected) return;
  dupFolder = selected;
  dupPathEl.value = selected;
  dupScanBtn.disabled = false;
  dupListEl.innerHTML = "";
  dupResultEl.textContent = "";
  dupDeleteBtn.disabled = true;
});

dupScanBtn.addEventListener("click", async () => {
  if (!dupFolder) return;
  setStatus("Recherche des doublons… (peut prendre un moment)");
  dupResultEl.textContent = "";
  dupListEl.innerHTML = '<div class="empty-state">Analyse en cours…</div>';
  try {
    const groups = await invoke("find_duplicates", { folder: dupFolder });
    renderDupGroups(groups);
    setStatus(`${groups.length} groupe(s) de doublons trouvé(s).`);
  } catch (e) {
    dupListEl.innerHTML = "";
    dupResultEl.textContent = `Erreur : ${e}`;
    setStatus("Erreur.");
  }
});

function renderDupGroups(groups) {
  dupListEl.innerHTML = "";
  if (groups.length === 0) {
    dupListEl.innerHTML = '<div class="empty-state">Aucun doublon trouvé.</div>';
    dupDeleteBtn.disabled = true;
    return;
  }
  groups.forEach((group, gi) => {
    const wrap = document.createElement("div");
    wrap.className = "group";
    const wasted = group.size_bytes * (group.paths.length - 1);
    wrap.innerHTML = `<div class="group-header"><span>${group.paths.length} copies · ${formatBytes(group.size_bytes)} chacune</span><span>${formatBytes(wasted)} gaspillé</span></div>`;
    group.paths.forEach((p, pi) => {
      const row = document.createElement("label");
      row.className = "list-item";
      // Keep the first occurrence unchecked by default (the one to preserve).
      const checkedAttr = pi === 0 ? "" : "checked";
      row.innerHTML = `
        <input type="checkbox" data-path="${p}" data-group="${gi}" ${checkedAttr} />
        <div class="meta"><div class="name">${p}</div></div>
      `;
      wrap.appendChild(row);
    });
    dupListEl.appendChild(wrap);
  });
  updateDupDeleteState();
  dupListEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", updateDupDeleteState);
  });
}

function updateDupDeleteState() {
  const checked = dupListEl.querySelectorAll("input[type=checkbox]:checked");
  dupDeleteBtn.disabled = checked.length === 0;
}

dupDeleteBtn.addEventListener("click", async () => {
  const checked = [...dupListEl.querySelectorAll("input[type=checkbox]:checked")].map(
    (cb) => cb.dataset.path
  );
  if (checked.length === 0) return;
  setStatus("Suppression en cours…");
  try {
    const res = await invoke("delete_files", { paths: checked });
    dupResultEl.textContent = `${formatBytes(res.freed_bytes)} libéré(s), envoyé(s) à la Corbeille.` +
      (res.errors.length ? `\n${res.errors.length} erreur(s).` : "");
    setStatus("Suppression terminée.");
    dupScanBtn.click();
  } catch (e) {
    dupResultEl.textContent = `Erreur : ${e}`;
    setStatus("Erreur.");
  }
});

// ---------- Espace disque ----------
const diskPathEl = document.getElementById("disk-path");
const diskPickBtn = document.getElementById("disk-pick");
const diskListEl = document.getElementById("disk-list");
const diskBreadcrumbEl = document.getElementById("disk-breadcrumb");
let diskHistory = [];

diskPickBtn.addEventListener("click", async () => {
  const selected = await open({ directory: true, multiple: false });
  if (!selected) return;
  diskHistory = [selected];
  diskPathEl.value = selected;
  await loadDiskUsage(selected);
});

async function loadDiskUsage(folder) {
  setStatus("Analyse de l'espace disque…");
  diskListEl.innerHTML = '<div class="empty-state">Analyse en cours…</div>';
  try {
    const entries = await invoke("analyze_disk_usage", { folder });
    renderDiskList(entries);
    renderBreadcrumb();
    setStatus("Analyse terminée.");
  } catch (e) {
    diskListEl.innerHTML = "";
    diskListEl.textContent = `Erreur : ${e}`;
    setStatus("Erreur.");
  }
}

function renderBreadcrumb() {
  diskBreadcrumbEl.innerHTML = diskHistory
    .map((p, i) => {
      const label = p.split("/").filter(Boolean).pop() || p;
      return `<span data-index="${i}">${label}</span>`;
    })
    .join(" / ");
  diskBreadcrumbEl.querySelectorAll("span").forEach((span) => {
    span.addEventListener("click", () => {
      const idx = Number(span.dataset.index);
      diskHistory = diskHistory.slice(0, idx + 1);
      loadDiskUsage(diskHistory[diskHistory.length - 1]);
    });
  });
}

function renderDiskList(entries) {
  diskListEl.innerHTML = "";
  if (entries.length === 0) {
    diskListEl.innerHTML = '<div class="empty-state">Dossier vide.</div>';
    return;
  }
  const maxSize = Math.max(...entries.map((e) => e.size_bytes), 1);
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "list-item" + (entry.is_dir ? " dir-row" : "");
    row.innerHTML = `
      <div class="meta">
        <div class="name">${entry.is_dir ? "📁" : "📄"} ${entry.name}</div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${(entry.size_bytes / maxSize) * 100}%"></div></div>
      <div class="size">${formatBytes(entry.size_bytes)}</div>
    `;
    if (entry.is_dir) {
      row.addEventListener("click", () => {
        diskHistory.push(entry.path);
        loadDiskUsage(entry.path);
      });
    }
    diskListEl.appendChild(row);
  });
}
