const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const { getVersion } = window.__TAURI__.app;
const { check: checkUpdate } = window.__TAURI__.updater;
const { relaunch } = window.__TAURI__.process;
const { openUrl } = window.__TAURI__.opener;

const statusbar = document.getElementById("statusbar");
function setStatus(msg) {
  statusbar.textContent = msg;
}

getVersion()
  .then((v) => {
    document.getElementById("app-version").textContent = `v${v}`;
  })
  .catch(() => {});

// ---------- Mise à jour automatique ----------
// Checks silently in the background; the banner only ever appears when
// there's actually something to offer, and "Plus tard" just dismisses it
// for this session — never a blocking dialog, never nagging.
const updateBanner = document.getElementById("update-banner");
const updateBannerText = document.getElementById("update-banner-text");
const updateInstallBtn = document.getElementById("update-install");
const updateDismissBtn = document.getElementById("update-dismiss");
let pendingUpdate = null;

async function checkForUpdate() {
  try {
    const update = await checkUpdate();
    if (update?.available) {
      pendingUpdate = update;
      updateBannerText.textContent = `Nouvelle version disponible : v${update.version}`;
      updateBanner.hidden = false;
    }
  } catch (e) {
    // Offline, GitHub unreachable, etc. — never surface this to the user.
  }
}

updateDismissBtn.addEventListener("click", () => {
  updateBanner.hidden = true;
});

updateInstallBtn.addEventListener("click", () =>
  withBusy(updateInstallBtn, "Téléchargement…", installUpdate)
);

async function installUpdate() {
  if (!pendingUpdate) return;
  try {
    await pendingUpdate.downloadAndInstall();
    await relaunch();
  } catch (e) {
    updateBannerText.textContent = `Erreur lors de la mise à jour : ${e}`;
  }
}

setTimeout(checkForUpdate, 1500);

// ---------- Accès complet au disque ----------
// macOS prompts once per protected folder category (Bureau, Documents,
// Téléchargements…) the first time an app touches each one — picking a
// broad folder to scan can trigger a dozen of these in a row. Granting
// Full Disk Access once in System Settings skips all of them permanently.
const FDA_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

document.getElementById("fda-btn").addEventListener("click", () => {
  openUrl(FDA_URL).catch(() => {});
});

const fdaBanner = document.getElementById("fda-banner");
const FDA_HINT_KEY = "macadam_fda_hint_dismissed";

try {
  if (!localStorage.getItem(FDA_HINT_KEY)) {
    fdaBanner.hidden = false;
  }
} catch (e) {
  // Private window / blocked storage — just skip the one-time hint.
}

function dismissFdaHint() {
  fdaBanner.hidden = true;
  try {
    localStorage.setItem(FDA_HINT_KEY, "1");
  } catch (e) {
    // Non-fatal — worst case the hint reappears next launch.
  }
}

document.getElementById("fda-banner-dismiss").addEventListener("click", dismissFdaHint);
document.getElementById("fda-banner-open").addEventListener("click", () => {
  openUrl(FDA_URL).catch(() => {});
  dismissFdaHint();
});

// Disables `button` and swaps its label to `busyLabel` while `fn` runs,
// so a multi-second scan/clean can't look like a frozen click with no
// feedback (the bug this app shipped with in v0.1.0).
async function withBusy(button, busyLabel, fn) {
  const originalLabel = button.textContent;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await fn();
  } finally {
    button.textContent = originalLabel;
    button.disabled = wasDisabled;
  }
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
    // The treemap is laid out from the container's pixel size, which is
    // 0x0 while its panel is display:none — re-measure now that it's visible.
    if (tab.dataset.tab === "disk" && diskView === "treemap" && currentDiskEntries.length > 0) {
      requestAnimationFrame(() => renderDiskTreemap(currentDiskEntries));
    }
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

organizePreviewBtn.addEventListener("click", () =>
  withBusy(organizePreviewBtn, "Analyse…", organizePreview)
);

async function organizePreview() {
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
}

organizeRunBtn.addEventListener("click", () =>
  withBusy(organizeRunBtn, "Rangement…", organizeRun)
);

async function organizeRun() {
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
}

// ---------- Nettoyage ----------
const cacheScanBtn = document.getElementById("cache-scan");
const cacheCleanBtn = document.getElementById("cache-clean");
const cacheListEl = document.getElementById("cache-list");
const cacheResultEl = document.getElementById("cache-result");
let cacheEntries = [];

cacheScanBtn.addEventListener("click", () => withBusy(cacheScanBtn, "Scan en cours…", cacheScan));

async function cacheScan() {
  setStatus("Scan des caches…");
  cacheResultEl.textContent = "";
  cacheListEl.innerHTML = '<div class="empty-state">Scan en cours…</div>';
  try {
    cacheEntries = await invoke("scan_caches");
    renderCacheList();
    setStatus("Scan terminé.");
  } catch (e) {
    cacheListEl.innerHTML = "";
    cacheResultEl.textContent = `Erreur : ${e}`;
    setStatus("Erreur.");
  }
}

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

cacheCleanBtn.addEventListener("click", () =>
  withBusy(cacheCleanBtn, "Nettoyage…", cacheClean)
);

async function cacheClean() {
  const checked = [...cacheListEl.querySelectorAll("input[type=checkbox]:checked")].map(
    (cb) => cb.dataset.path
  );
  if (checked.length === 0) return;
  setStatus("Nettoyage en cours…");
  try {
    const res = await invoke("clean_caches", { paths: checked });
    const lines = [`${formatBytes(res.freed_bytes)} libéré(s), envoyé(s) à la Corbeille.`];
    if (res.skipped.length) {
      lines.push(`${res.skipped.length} élément(s) protégé(s) par macOS ignoré(s) : ${res.skipped.join(", ")}`);
    }
    if (res.errors.length) {
      lines.push(`${res.errors.length} erreur(s) : ${res.errors.join(", ")}`);
    }
    cacheResultEl.textContent = lines.join("\n");
    setStatus("Nettoyage terminé.");
    await cacheScan();
  } catch (e) {
    cacheResultEl.textContent = `Erreur : ${e}`;
    setStatus("Erreur.");
  }
}

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

dupScanBtn.addEventListener("click", () => withBusy(dupScanBtn, "Recherche…", dupScan));

async function dupScan() {
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
}

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
      const keepAttr = pi === 0 ? "checked" : "";
      row.innerHTML = `
        <input type="radio" name="keep-group-${gi}" class="keep-radio" data-path="${p}" title="Garder comme original" ${keepAttr} />
        <input type="checkbox" data-path="${p}" data-group="${gi}" ${checkedAttr} />
        <div class="meta"><div class="name">${p}</div></div>
      `;
      wrap.appendChild(row);
    });
    const mergeRow = document.createElement("div");
    mergeRow.className = "group-actions";
    mergeRow.innerHTML = `<button class="btn btn-secondary btn-sm merge-btn">Fusionner ce groupe (clone APFS)</button>`;
    mergeRow.querySelector("button").addEventListener("click", (ev) =>
      withBusy(ev.target, "Fusion…", () => mergeGroup(wrap, group))
    );
    wrap.appendChild(mergeRow);
    dupListEl.appendChild(wrap);
  });
  updateDupDeleteState();
  dupListEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", updateDupDeleteState);
  });
}

async function mergeGroup(groupEl, group) {
  const keepInput = groupEl.querySelector(".keep-radio:checked");
  const keep = keepInput.dataset.path;
  const duplicates = group.paths.filter((p) => p !== keep);
  try {
    const res = await invoke("clone_merge_files", { keep, duplicates });
    dupResultEl.textContent = `${res.merged} fichier(s) fusionné(s), ${formatBytes(res.freed_bytes)} partagé(s) (clone APFS).` +
      (res.errors.length ? `\n${res.errors.join("\n")}` : "");
    setStatus("Fusion terminée.");
    await dupScan();
  } catch (e) {
    dupResultEl.textContent = `Erreur : ${e}`;
    setStatus("Erreur.");
  }
}

function updateDupDeleteState() {
  const checked = dupListEl.querySelectorAll("input[type=checkbox]:checked");
  dupDeleteBtn.disabled = checked.length === 0;
}

dupDeleteBtn.addEventListener("click", () =>
  withBusy(dupDeleteBtn, "Suppression…", dupDelete)
);

async function dupDelete() {
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
    await dupScan();
  } catch (e) {
    dupResultEl.textContent = `Erreur : ${e}`;
    setStatus("Erreur.");
  }
}

// ---------- Espace disque ----------
const diskPathEl = document.getElementById("disk-path");
const diskPickBtn = document.getElementById("disk-pick");
const diskListEl = document.getElementById("disk-list");
const diskTreemapEl = document.getElementById("disk-treemap");
const diskGrowthEl = document.getElementById("disk-growth");
const diskLegendEl = document.getElementById("disk-legend");
const diskBreadcrumbEl = document.getElementById("disk-breadcrumb");
const diskViewToggle = document.getElementById("disk-view-toggle");
const growth3dEl = document.getElementById("growth-3d");
const growthTableEl = document.getElementById("growth-table");
const growthStatusEl = document.getElementById("growth-status");
const growthViewToggle = document.getElementById("growth-view-toggle");
let diskHistory = [];
let diskView = "treemap";
let growthSubView = "3d";
let currentDiskEntries = [];
let growthLoadedFor = null;

// Three validated categorical slots (see dataviz skill) plus a neutral,
// non-series color for folders — kept in sync with the Rangement
// categories so the same file type always reads the same color.
const MEDIA_EXT = new Set(["jpg","jpeg","png","webp","gif","bmp","tiff","heic","svg","mp3","wav","m4a","aac","flac","mp4","mov","avi","mkv","webm"]);
const DOCS_EXT = new Set(["pdf","doc","docx","odt","rtf","txt","md","html","htm","xlsx","xls","csv","py","json","js","ts","rs","go","java","c","cpp","sh"]);

function diskBucket(entry) {
  if (entry.is_dir) return "folder";
  const ext = entry.name.includes(".") ? entry.name.split(".").pop().toLowerCase() : "";
  if (MEDIA_EXT.has(ext)) return "media";
  if (DOCS_EXT.has(ext)) return "docs";
  return "other";
}

const BUCKET_COLOR_VAR = {
  folder: "--viz-folder",
  media: "--viz-media",
  docs: "--viz-docs",
  other: "--viz-other",
};

diskViewToggle.querySelectorAll("button").forEach((btn) => {
  btn.addEventListener("click", () => {
    diskViewToggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    diskView = btn.dataset.view;
    diskListEl.hidden = diskView !== "list";
    diskTreemapEl.hidden = diskView !== "treemap";
    diskGrowthEl.hidden = diskView !== "growth";
    diskLegendEl.hidden = diskView === "growth";
    renderCurrentView();
  });
});

growthViewToggle.querySelectorAll("button").forEach((btn) => {
  btn.addEventListener("click", () => {
    growthViewToggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    growthSubView = btn.dataset.view;
    growth3dEl.hidden = growthSubView !== "3d";
    growthTableEl.hidden = growthSubView !== "table";
  });
});

diskPickBtn.addEventListener("click", async () => {
  const selected = await open({ directory: true, multiple: false });
  if (!selected) return;
  diskHistory = [selected];
  diskPathEl.value = selected;
  await loadDiskUsage(selected);
});

async function loadDiskUsage(folder) {
  setStatus("Analyse de l'espace disque…");
  diskTreemapEl.innerHTML = '<div class="empty-state">Analyse en cours…</div>';
  diskListEl.innerHTML = "";
  try {
    currentDiskEntries = await invoke("analyze_disk_usage", { folder });
    renderBreadcrumb();
    renderCurrentView();
    setStatus("Analyse terminée.");
  } catch (e) {
    diskTreemapEl.innerHTML = "";
    diskTreemapEl.textContent = `Erreur : ${e}`;
    setStatus("Erreur.");
  }
}

function renderCurrentView() {
  if (diskView === "treemap") {
    renderDiskTreemap(currentDiskEntries);
  } else if (diskView === "list") {
    renderDiskList(currentDiskEntries);
  } else if (diskView === "growth") {
    const folder = diskHistory[diskHistory.length - 1];
    if (growthLoadedFor !== folder) {
      loadGrowth(folder);
    }
  }
}

async function loadGrowth(folder) {
  growthLoadedFor = folder;
  growthStatusEl.textContent = "Analyse en cours…";
  growth3dEl.innerHTML = "";
  growthTableEl.innerHTML = "";
  try {
    const report = await invoke("get_growth", { folder });
    renderGrowth(report);
  } catch (e) {
    growthStatusEl.textContent = `Erreur : ${e}`;
  }
}

function renderGrowth(report) {
  if (!report.has_baseline) {
    growthStatusEl.textContent = "Pas encore d'historique pour ce dossier — un premier instantané vient d'être pris. Repasse dans quelques jours pour voir son évolution.";
    growth3dEl.innerHTML = "";
    growthTableEl.innerHTML = "";
    return;
  }

  growthStatusEl.textContent = `Comparé à il y a ${report.baseline_age_days} jour(s).`;

  if (report.changes.length === 0) {
    growth3dEl.innerHTML = '<div class="empty-state">Rien n\'a changé de façon notable depuis la dernière comparaison.</div>';
    growthTableEl.innerHTML = "";
    return;
  }

  const maxAbs = Math.max(...report.changes.map((c) => Math.abs(c.delta_bytes)), 1);
  const scene = document.createElement("div");
  scene.className = "scene3d";

  report.changes.forEach((c) => {
    const grew = c.delta_bytes > 0;
    const heightPx = Math.max(8, Math.round((Math.abs(c.delta_bytes) / maxAbs) * 180));
    const col = document.createElement("div");
    col.className = `bar3d-col ${grew ? "grow" : "shrink"}`;
    const sign = grew ? "+" : "−";
    col.innerHTML = `
      <div class="bar3d ${grew ? "grow" : "shrink"}" style="height:${heightPx}px" title="${c.name} : ${sign}${formatBytes(Math.abs(c.delta_bytes))}">
        <div class="bar3d-top"></div>
        <div class="bar3d-side"></div>
        <div class="bar3d-front"></div>
      </div>
      <div class="bar3d-label">
        <span class="bl-name">${c.is_dir ? "📁" : "📄"} ${c.name}</span>
        <span class="bl-delta">${sign}${formatBytes(Math.abs(c.delta_bytes))}</span>
      </div>
    `;
    scene.appendChild(col);
  });

  growth3dEl.innerHTML = "";
  growth3dEl.appendChild(scene);

  growthTableEl.innerHTML = "";
  report.changes.forEach((c) => {
    const grew = c.delta_bytes > 0;
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="meta">
        <div class="name">${c.is_dir ? "📁" : "📄"} ${c.name}</div>
        <div class="sub">${formatBytes(c.past_bytes)} → ${formatBytes(c.current_bytes)}</div>
      </div>
      <div class="size" style="color:var(${grew ? "--viz-grow" : "--viz-shrink"})">${grew ? "+" : "−"}${formatBytes(Math.abs(c.delta_bytes))}</div>
    `;
    growthTableEl.appendChild(row);
  });
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

// Classic "squarify" treemap layout (Bruls, Huizing & van Wijk): lays
// successive rows along the shorter side of the remaining rectangle so
// tiles stay close to square instead of degenerating into slivers.
function squarify(items, x, y, w, h) {
  const rects = [];
  const totalValue = items.reduce((s, i) => s + i.value, 0);
  if (totalValue <= 0 || items.length === 0 || w <= 0 || h <= 0) return rects;

  const scale = (w * h) / totalValue;
  let remaining = items.map((i) => ({ ...i, area: i.value * scale }));
  let rx = x, ry = y, rw = w, rh = h;

  function worst(row, side) {
    const sum = row.reduce((s, r) => s + r.area, 0);
    const maxA = Math.max(...row.map((r) => r.area));
    const minA = Math.min(...row.map((r) => r.area));
    return Math.max((side * side * maxA) / (sum * sum), (sum * sum) / (side * side * minA));
  }

  while (remaining.length > 0) {
    const side = Math.min(rw, rh);
    let row = [remaining[0]];
    let i = 1;
    while (i < remaining.length) {
      const nextRow = row.concat(remaining[i]);
      if (worst(nextRow, side) <= worst(row, side)) {
        row = nextRow;
        i++;
      } else {
        break;
      }
    }

    const rowAreaSum = row.reduce((s, r) => s + r.area, 0);
    if (rw >= rh) {
      const colWidth = rh > 0 ? rowAreaSum / rh : 0;
      let cy = ry;
      for (const item of row) {
        const itemHeight = colWidth > 0 ? item.area / colWidth : 0;
        rects.push({ ...item, x: rx, y: cy, w: colWidth, h: itemHeight });
        cy += itemHeight;
      }
      rx += colWidth;
      rw -= colWidth;
    } else {
      const rowHeight = rw > 0 ? rowAreaSum / rw : 0;
      let cx = rx;
      for (const item of row) {
        const itemWidth = rowHeight > 0 ? item.area / rowHeight : 0;
        rects.push({ ...item, x: cx, y: ry, w: itemWidth, h: rowHeight });
        cx += itemWidth;
      }
      ry += rowHeight;
      rh -= rowHeight;
    }

    remaining = remaining.slice(row.length);
  }

  return rects;
}

const TREEMAP_MAX_TILES = 40;

function renderDiskTreemap(entries) {
  diskTreemapEl.innerHTML = "";
  const withSize = entries.filter((e) => e.size_bytes > 0);
  if (withSize.length === 0) {
    diskTreemapEl.innerHTML = '<div class="empty-state">Dossier vide (ou tous les éléments font 0 octet).</div>';
    return;
  }

  const sorted = [...withSize].sort((a, b) => b.size_bytes - a.size_bytes);
  let items = sorted;
  if (sorted.length > TREEMAP_MAX_TILES) {
    const head = sorted.slice(0, TREEMAP_MAX_TILES - 1);
    const rest = sorted.slice(TREEMAP_MAX_TILES - 1);
    const restSize = rest.reduce((s, e) => s + e.size_bytes, 0);
    items = [
      ...head,
      {
        name: `Autres (${rest.length} éléments)`,
        path: null,
        is_dir: false,
        size_bytes: restSize,
        isAggregate: true,
      },
    ];
  }

  const rect = diskTreemapEl.getBoundingClientRect();
  const layout = squarify(
    items.map((e) => ({ ...e, value: e.size_bytes })),
    0,
    0,
    rect.width,
    rect.height
  );

  for (const tile of layout) {
    const el = document.createElement("div");
    const bucket = tile.isAggregate ? "other" : diskBucket(tile);
    el.className = "treemap-tile" + (tile.is_dir && !tile.isAggregate ? " clickable" : "");
    el.style.left = `${tile.x}px`;
    el.style.top = `${tile.y}px`;
    el.style.width = `${Math.max(tile.w, 0)}px`;
    el.style.height = `${Math.max(tile.h, 0)}px`;
    el.style.background = `var(${BUCKET_COLOR_VAR[bucket]})`;
    el.title = `${tile.name} — ${formatBytes(tile.size_bytes)}`;

    if (tile.w > 36 && tile.h > 20) {
      const label = document.createElement("div");
      label.className = "tile-label";
      label.innerHTML = `<span class="tl-name">${tile.is_dir ? "📁 " : ""}${tile.name}</span><span class="tl-size">${formatBytes(tile.size_bytes)}</span>`;
      el.appendChild(label);
    }

    if (tile.is_dir && !tile.isAggregate) {
      el.addEventListener("click", () => {
        diskHistory.push(tile.path);
        loadDiskUsage(tile.path);
      });
    }

    diskTreemapEl.appendChild(el);
  }
}

let resizeRaf = null;
window.addEventListener("resize", () => {
  if (diskView !== "treemap" || currentDiskEntries.length === 0) return;
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => renderDiskTreemap(currentDiskEntries));
});

// ---------- Démarrage ----------
const loginItemsListEl = document.getElementById("login-items-list");
const loginItemsResultEl = document.getElementById("login-items-result");
const loginItemsRefreshBtn = document.getElementById("login-items-refresh");
const launchAgentsListEl = document.getElementById("launch-agents-list");
const launchAgentsResultEl = document.getElementById("launch-agents-result");
const launchAgentsRefreshBtn = document.getElementById("launch-agents-refresh");
let startupLoaded = false;

async function loadLoginItems() {
  loginItemsResultEl.textContent = "";
  loginItemsListEl.innerHTML = '<div class="empty-state">Chargement…</div>';
  try {
    const items = await invoke("list_login_items");
    renderLoginItems(items);
  } catch (e) {
    loginItemsListEl.innerHTML = "";
    loginItemsResultEl.textContent = e;
  }
}

function renderLoginItems(items) {
  loginItemsListEl.innerHTML = "";
  if (items.length === 0) {
    loginItemsListEl.innerHTML = '<div class="empty-state">Aucune application au démarrage.</div>';
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="meta">
        <div class="name">${item.name}</div>
        <div class="sub">${item.path || ""}</div>
      </div>
      <button class="btn-text-danger">Retirer</button>
    `;
    row.querySelector("button").addEventListener("click", async (ev) => {
      if (!confirm(`Retirer « ${item.name} » du démarrage ? Cette action n'est pas réversible depuis Macadam.`)) {
        return;
      }
      const btn = ev.target;
      btn.disabled = true;
      btn.textContent = "…";
      try {
        await invoke("remove_login_item", { name: item.name });
        await loadLoginItems();
      } catch (e) {
        loginItemsResultEl.textContent = `Erreur : ${e}`;
        btn.disabled = false;
        btn.textContent = "Retirer";
      }
    });
    loginItemsListEl.appendChild(row);
  });
}

async function loadLaunchAgents() {
  launchAgentsResultEl.textContent = "";
  launchAgentsListEl.innerHTML = '<div class="empty-state">Chargement…</div>';
  try {
    const agents = await invoke("list_launch_agents");
    renderLaunchAgents(agents);
  } catch (e) {
    launchAgentsListEl.innerHTML = "";
    launchAgentsResultEl.textContent = `Erreur : ${e}`;
  }
}

function renderLaunchAgents(agents) {
  launchAgentsListEl.innerHTML = "";
  if (agents.length === 0) {
    launchAgentsListEl.innerHTML = '<div class="empty-state">Aucun agent en arrière-plan.</div>';
    return;
  }
  agents.forEach((agent) => {
    const row = document.createElement("div");
    row.className = "list-item";
    const isSystem = agent.scope === "system";
    row.innerHTML = `
      <div class="meta">
        <div class="name">${agent.label}</div>
        <div class="sub">${agent.path}</div>
      </div>
      ${isSystem ? '<span class="badge">Système · lecture seule</span>' : ""}
      <label class="switch">
        <input type="checkbox" ${agent.enabled ? "checked" : ""} ${isSystem ? "disabled" : ""} />
        <span class="slider"></span>
      </label>
    `;
    if (!isSystem) {
      const checkbox = row.querySelector("input");
      checkbox.addEventListener("change", async () => {
        const enable = checkbox.checked;
        checkbox.disabled = true;
        try {
          await invoke("toggle_launch_agent", { path: agent.path, enable });
          await loadLaunchAgents();
        } catch (e) {
          launchAgentsResultEl.textContent = `Erreur : ${e}`;
          checkbox.checked = !enable;
          checkbox.disabled = false;
        }
      });
    }
    launchAgentsListEl.appendChild(row);
  });
}

loginItemsRefreshBtn.addEventListener("click", () =>
  withBusy(loginItemsRefreshBtn, "…", loadLoginItems)
);
launchAgentsRefreshBtn.addEventListener("click", () =>
  withBusy(launchAgentsRefreshBtn, "…", loadLaunchAgents)
);

// Lazy-load on first visit only — listing login items triggers a one-time
// macOS "control System Events" permission prompt, no reason to show that
// before the user has even opened this tab.
document.querySelector('.tab[data-tab="startup"]').addEventListener("click", () => {
  if (startupLoaded) return;
  startupLoaded = true;
  loadLoginItems();
  loadLaunchAgents();
});

// ---------- Applications inutilisées ----------
const appsScanBtn = document.getElementById("apps-scan");
const appsListEl = document.getElementById("apps-list");
const appsResultEl = document.getElementById("apps-result");

function formatLastUsed(days) {
  if (days === null || days === undefined) return "Jamais ouvert";
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  if (days < 30) return `Il y a ${days} jours`;
  if (days < 365) return `Il y a ${Math.round(days / 30)} mois`;
  return `Il y a ${(days / 365).toFixed(1)} ans`;
}

appsScanBtn.addEventListener("click", () => withBusy(appsScanBtn, "Scan en cours…", appsScan));

async function appsScan() {
  appsResultEl.textContent = "";
  appsListEl.innerHTML = '<div class="empty-state">Scan en cours…</div>';
  try {
    const apps = await invoke("list_apps");
    renderApps(apps);
    setStatus(`${apps.length} application(s) trouvée(s).`);
  } catch (e) {
    appsListEl.innerHTML = "";
    appsResultEl.textContent = `Erreur : ${e}`;
  }
}

function renderApps(apps) {
  appsListEl.innerHTML = "";
  if (apps.length === 0) {
    appsListEl.innerHTML = '<div class="empty-state">Aucune application trouvée.</div>';
    return;
  }
  apps.forEach((app) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="meta">
        <div class="name">${app.name}</div>
        <div class="sub">${formatLastUsed(app.days_since_used)} · ${formatBytes(app.size_bytes)}</div>
      </div>
      <button class="btn-text-danger">Supprimer</button>
    `;
    row.querySelector("button").addEventListener("click", async (ev) => {
      const btn = ev.target;
      btn.disabled = true;
      btn.textContent = "…";
      try {
        await invoke("trash_app", { path: app.path });
        row.remove();
        setStatus(`« ${app.name} » envoyée à la Corbeille.`);
      } catch (e) {
        appsResultEl.textContent = `Erreur : ${e}`;
        btn.disabled = false;
        btn.textContent = "Supprimer";
      }
    });
    appsListEl.appendChild(row);
  });
}
