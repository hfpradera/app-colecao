const form = document.querySelector("#itemForm");
const itemId = document.querySelector("#itemId");
const formTitle = document.querySelector("#formTitle");
const cancelEditBtn = document.querySelector("#cancelEditBtn");
const newItemBtn = document.querySelector("#newItemBtn");
const itemList = document.querySelector("#itemList");
const emptyState = document.querySelector("#emptyState");
const searchInput = document.querySelector("#searchInput");
const tipoFilter = document.querySelector("#tipoFilter");
const photoPreview = document.querySelector("#photoPreview");
const clearPhotoBtn = document.querySelector("#clearPhotoBtn");
const photoUpload = document.querySelector("#foto_upload");
const photoCamera = document.querySelector("#foto_camera");
const batchStatus = document.querySelector("#batchStatus");
const cameraButton = document.querySelector("#cameraButton");
const checkCurrentPhotoBtn = document.querySelector("#checkCurrentPhotoBtn");
const identifyPhotoBtn = document.querySelector("#identifyPhotoBtn");
const cadastroTab = document.querySelector("#cadastroTab");
const verificarTab = document.querySelector("#verificarTab");
const cadastroPanel = document.querySelector("#cadastroPanel");
const verificarPanel = document.querySelector("#verificarPanel");
const verifyTipo = document.querySelector("#verifyTipo");
const verifyUpload = document.querySelector("#verifyUpload");
const verifyCamera = document.querySelector("#verifyCamera");
const verifyCameraButton = document.querySelector("#verifyCameraButton");
const verifyPreview = document.querySelector("#verifyPreview");
const verifyResult = document.querySelector("#verifyResult");
const collectionButtons = [...document.querySelectorAll("[data-collection]")];
const selectedCollectionLabel = document.querySelector("#selectedCollectionLabel");
const costPill = document.querySelector("#costPill");
const formPanel = document.querySelector("#formPanel");
const drawerOverlay = document.querySelector("#drawerOverlay");
const bottomNavBtns = [...document.querySelectorAll(".bnav-btn")];
const itemModalOverlay = document.querySelector("#itemModalOverlay");
const itemModalPhoto = document.querySelector("#itemModalPhoto");
const itemModalBody = document.querySelector("#itemModalBody");
const itemModalClose = document.querySelector("#itemModalClose");
const itemModalEditBtn = document.querySelector("#itemModalEditBtn");
const itemModalRotateBtn = document.querySelector("#itemModalRotateBtn");
const itemModalDeleteBtn = document.querySelector("#itemModalDeleteBtn");
const autenticidadeFilter = document.querySelector("#autenticidadeFilter");
const ordemFilter = document.querySelector("#ordemFilter");
const timeFilter = document.querySelector("#timeFilter");

const fields = [
  "tipo",
  "nome",
  "marca",
  "time",
  "cor",
  "tamanho",
  "ano",
  "localizacao",
  "data_compra",
  "foto_url",
  "observacoes",
  "autenticidade",
];

let currentItems = [];
let selectedCollection = "bone"; // tipo padrão para o formulário de cadastro
let viewFilter = ""; // filtro de tipo da lista ("" = tudo)
let sessionCost = Number(localStorage.getItem("aiSessionCost") || "0");
let activeModalItem = null;

const collectionNames = {
  bone: "bonés",
  camisa: "camisas",
  oculos: "óculos",
};

const TIPO_CONFIG = {
  bone: {
    nomePlaceholder: "Ex.: New Era 9FIFTY New York Yankees",
    timeLabel: "Time / Tema",
    showTime: true,
    corPlaceholder: "Preto, dourado...",
    showTamanho: true,
    tamanhoPlaceholder: "",
  },
  camisa: {
    nomePlaceholder: "Ex.: Flamengo Third Kit 2023/24",
    timeLabel: "Time / Seleção",
    showTime: true,
    corPlaceholder: "Azul e branco, listrado...",
    showTamanho: true,
    tamanhoPlaceholder: "P, M, G, GG / XS, S, M, L, XL",
  },
  oculos: {
    nomePlaceholder: "Ex.: Ray-Ban Wayfarer RB2140",
    timeLabel: "Time",
    showTime: false,
    corPlaceholder: "Armação: preta / Lentes: polarizadas",
    showTamanho: false,
    tamanhoPlaceholder: "",
  },
};

function adaptFormForTipo(tipo) {
  const config = TIPO_CONFIG[tipo] || TIPO_CONFIG.bone;

  document.querySelector("#nome").placeholder = config.nomePlaceholder;
  document.querySelector("#timeLabelText").textContent = config.timeLabel;
  document.querySelector("#cor").placeholder = config.corPlaceholder;
  document.querySelector("#tamanho").placeholder = config.tamanhoPlaceholder;

  const labelTime = document.querySelector("#labelTime");
  const labelTamanho = document.querySelector("#labelTamanho");
  const rowMarcaTime = document.querySelector("#rowMarcaTime");
  const rowCorTamanho = document.querySelector("#rowCorTamanho");

  labelTime.style.display = config.showTime ? "" : "none";
  rowMarcaTime.classList.toggle("one-item", !config.showTime);

  labelTamanho.style.display = config.showTamanho ? "" : "none";
  rowCorTamanho.classList.toggle("one-item", !config.showTamanho);
}

function isDrawerMode() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function setBottomNavActive(nav) {
  bottomNavBtns.forEach((b) => b.classList.remove("active"));
  const btn = document.querySelector(`.bnav-btn[data-nav="${nav}"]`);
  if (btn) btn.classList.add("active");
}

function openDrawer(tab) {
  if (tab) setTab(tab);
  formPanel.classList.add("drawer-open");
  drawerOverlay.classList.add("visible");
  document.body.style.overflow = "hidden";
  setBottomNavActive(tab === "verificar" ? "verificar" : "adicionar");
}

function closeDrawer() {
  formPanel.classList.remove("drawer-open");
  drawerOverlay.classList.remove("visible");
  document.body.style.overflow = "";
  setBottomNavActive("lista");
}

function apiUrl(path, params = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Erro inesperado." }));
    throw new Error(error.detail || "Erro inesperado.");
  }

  if (response.status === 204) return null;
  return response.json();
}

function normalizeTipo(tipo) {
  return {
    bone: "Boné",
    camisa: "Camisa",
    oculos: "Óculos",
  }[tipo] || tipo;
}

function placeholderFor(tipo) {
  const label = normalizeTipo(tipo);
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">
      <rect width="640" height="480" fill="#F2EFEA"/>
      <text x="50%" y="48%" text-anchor="middle" fill="#BE5C3A" font-family="Arial" font-size="34" font-weight="700">${label}</text>
      <text x="50%" y="59%" text-anchor="middle" fill="#A39C90" font-family="Arial" font-size="18">sem foto</text>
    </svg>
  `)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function updateCost(usage) {
  if (!usage || typeof usage.custo_usd !== "number") return;
  sessionCost += usage.custo_usd;
  localStorage.setItem("aiSessionCost", String(sessionCost));
  costPill.textContent = `IA · US$ ${sessionCost.toFixed(6)}`;
}

function getPayload() {
  const payload = {};
  fields.forEach((field) => {
    const element = document.querySelector(`#${field}`);
    payload[field] = element.value.trim();
  });

  payload.ano = payload.ano ? Number(payload.ano) : null;
  return payload;
}

function setPhoto(url) {
  document.querySelector("#foto_url").value = url || "";
  photoPreview.src = url || "";
  photoPreview.classList.toggle("visible", Boolean(url));
}

async function resizeIfNeeded(file, maxDim = 1200) {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (img.naturalWidth <= maxDim && img.naturalHeight <= maxDim) {
        resolve(file);
        return;
      }
      const scale = maxDim / Math.max(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name, { type: "image/jpeg" })),
        "image/jpeg",
        0.88,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
}

async function uploadRawPhoto(file) {
  if (!file) return { url: "", alreadyExists: false };
  const toUpload = await resizeIfNeeded(file);
  const formData = new FormData();
  formData.append("foto", toUpload);

  const response = await fetch("/api/uploads", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Nao foi possivel enviar a foto." }));
    throw new Error(error.detail || "Nao foi possivel enviar a foto.");
  }

  const data = await response.json();
  return { url: data.url || "", alreadyExists: data.already_exists || false };
}

async function uploadPhoto(file) {
  const { url } = await uploadRawPhoto(file);
  if (!url) return "";
  setPhoto(url);
  await identifyPhoto();
  return url;
}

async function identifyUploadedPhoto(fotoUrl) {
  const suggestion = await request("/api/identificar-foto", {
    method: "POST",
    body: JSON.stringify({
      foto_url: fotoUrl,
      tipo: selectedCollection,
    }),
  });
  updateCost(suggestion._uso);
  return suggestion;
}

async function identifyPhoto() {
  const fotoUrl = document.querySelector("#foto_url").value;
  if (!fotoUrl) {
    alert("Envie ou tire uma foto primeiro.");
    return;
  }

  identifyPhotoBtn.textContent = "...";
  identifyPhotoBtn.classList.add("loading");

  try {
    const suggestion = await identifyUploadedPhoto(fotoUrl);

    ["nome", "marca", "time", "cor", "ano", "observacoes"].forEach((field) => {
      const value = suggestion[field];
      const element = document.querySelector(`#${field}`);
      if (value !== null && value !== undefined && String(value).trim()) {
        element.value = value;
      }
    });
  } catch (error) {
    alert(error.message);
  } finally {
    identifyPhotoBtn.textContent = "IA";
    identifyPhotoBtn.classList.remove("loading");
  }
}

function setBatchStatus(message, visible = true) {
  batchStatus.textContent = message;
  batchStatus.classList.toggle("visible", visible);
}

async function processBatch(files) {
  const list = [...files];
  if (!list.length) return;

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const failedNames = [];

  setBatchStatus(`Processando 0 de ${list.length} fotos...`);

  for (const [index, file] of list.entries()) {
    setBatchStatus(`Processando ${index + 1} de ${list.length}...`);
    try {
      const { url: fotoUrl, alreadyExists } = await uploadRawPhoto(file);

      if (alreadyExists && currentItems.some((item) => item.foto_url === fotoUrl)) {
        skipped += 1;
        continue;
      }

      const suggestion = await identifyUploadedPhoto(fotoUrl);
      const ano = suggestion.ano ? Number(suggestion.ano) : null;
      const payload = {
        tipo: selectedCollection,
        nome: (suggestion.nome || file.name || `Item ${index + 1}`).slice(0, 120),
        marca: (suggestion.marca || "").slice(0, 80),
        time: (suggestion.time || "").slice(0, 80),
        cor: (suggestion.cor || "").slice(0, 80),
        tamanho: "",
        ano: (ano && ano >= 1900 && ano <= 2100) ? ano : null,
        localizacao: "",
        data_compra: "",
        foto_url: fotoUrl,
        observacoes: (suggestion.observacoes || "").slice(0, 1000),
      };
      await request("/api/itens", { method: "POST", body: JSON.stringify(payload) });
      created += 1;
    } catch (error) {
      failed += 1;
      const label = `${file.name || `Foto ${index + 1}`} (${error.message || "erro desconhecido"})`;
      failedNames.push(label);
    }
  }

  await refresh();

  const parts = [];
  if (created > 0) parts.push(`${created} cadastrado(s)`);
  if (skipped > 0) parts.push(`${skipped} ja existia(m)`);
  if (failed > 0) parts.push(`${failed} com erro`);
  let msg = `Lote concluido: ${parts.join(" · ")}`;
  if (failedNames.length) msg += `\nErros: ${failedNames.join(", ")}`;
  setBatchStatus(msg);
}

function setTab(name) {
  const cadastro = name === "cadastro";
  cadastroTab.classList.toggle("active", cadastro);
  verificarTab.classList.toggle("active", !cadastro);
  cadastroPanel.classList.toggle("active", cadastro);
  verificarPanel.classList.toggle("active", !cadastro);
}

// Define o tipo padrão do FORMULÁRIO de cadastro (não mexe na lista).
function setFormType(tipo) {
  selectedCollection = tipo;
  document.querySelector("#tipo").value = tipo;
  verifyTipo.value = tipo;
  selectedCollectionLabel.textContent = `Coleção de ${collectionNames[tipo] || "itens"}`;
  adaptFormForTipo(tipo);
}

// Filtra a LISTA por tipo ("" = tudo). Também ajusta o tipo padrão do cadastro.
function setFilter(tipo) {
  viewFilter = tipo;
  tipoFilter.value = tipo;
  if (tipo) setFormType(tipo);
  collectionButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.collection === tipo);
  });
  loadTimeFilter(tipo).then(() => loadItems()).catch((error) => alert(error.message));
}

function renderVerifyResult(result) {
  const suggestion = result.sugestao || {};
  const title = result.existe ? "Parece que ja existe na colecao." : "Nao encontrei um item igual cadastrado.";
  const detail = suggestion.nome ? `A IA identificou como: ${escapeHtml(suggestion.nome)}.` : "";
  const matches = result.matches || [];

  verifyResult.innerHTML = `
    <strong>${title}</strong>
    <span>${detail}</span>
    ${matches.length ? `
      <div class="match-list">
        ${matches.map((item) => `
          <div class="match-item">
            <strong>${escapeHtml(item.nome)}</strong>
            <span>${normalizeTipo(item.tipo)}${item.marca ? ` - ${escapeHtml(item.marca)}` : ""}${item.time ? ` - ${escapeHtml(item.time)}` : ""} - parecido: ${Math.round(item.score * 100)}%</span>
          </div>
        `).join("")}
      </div>
    ` : ""}
  `;
}

async function verifyPhoto(file) {
  if (!file) return;
  verifyResult.textContent = "Analisando foto...";

  try {
    const { url: fotoUrl } = await uploadRawPhoto(file);
    verifyPreview.src = fotoUrl;
    verifyPreview.classList.add("visible");
    const result = await request("/api/verificar-foto", {
      method: "POST",
      body: JSON.stringify({
        foto_url: fotoUrl,
        tipo: verifyTipo.value || null,
      }),
    });
    updateCost(result.sugestao?._uso);
    renderVerifyResult(result);
  } catch (error) {
    verifyResult.innerHTML = `<strong>Nao consegui verificar.</strong><span>${escapeHtml(error.message)}</span>`;
  }
}

async function verifyCurrentPhoto() {
  const fotoUrl = document.querySelector("#foto_url").value;
  if (!fotoUrl) {
    alert("Envie ou tire uma foto primeiro.");
    return;
  }

  openDrawer("verificar");
  verifyPreview.src = fotoUrl;
  verifyPreview.classList.add("visible");
  verifyResult.textContent = "Procurando itens parecidos...";

  try {
    const result = await request("/api/verificar-foto", {
      method: "POST",
      body: JSON.stringify({
        foto_url: fotoUrl,
        tipo: selectedCollection,
      }),
    });
    updateCost(result.sugestao?._uso);
    renderVerifyResult(result);
  } catch (error) {
    verifyResult.innerHTML = `<strong>Nao consegui verificar.</strong><span>${escapeHtml(error.message)}</span>`;
  }
}

async function openDeviceCamera(onFile, fallbackInput) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    fallbackInput.click();
    return;
  }

  let stream;
  const sheet = document.createElement("div");
  sheet.className = "camera-sheet";
  sheet.innerHTML = `
    <div class="camera-card">
      <video autoplay playsinline></video>
      <div class="camera-actions">
        <button class="primary" type="button" data-action="capture">Capturar</button>
        <button class="ghost" type="button" data-action="close">Fechar</button>
      </div>
    </div>
  `;
  document.body.appendChild(sheet);
  const video = sheet.querySelector("video");

  function closeCamera() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    sheet.remove();
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    video.srcObject = stream;
  } catch (error) {
    closeCamera();
    fallbackInput.click();
    return;
  }

  sheet.addEventListener("click", async (event) => {
    const action = event.target.dataset.action;
    if (action === "close") closeCamera();
    if (action === "capture") {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        closeCamera();
        const file = new File([blob], `foto-${Date.now()}.jpg`, { type: "image/jpeg" });
        await onFile(file);
      }, "image/jpeg", 0.9);
    }
  });
}

function fillForm(item) {
  itemId.value = item.id;
  setFormType(item.tipo);
  fields.forEach((field) => {
    const element = document.querySelector(`#${field}`);
    element.value = item[field] ?? "";
  });
  setPhoto(item.foto_url);
  formTitle.textContent = "Editar item";
  setTab("cadastro");
  openDrawer("cadastro");
}

function resetForm() {
  itemId.value = "";
  form.reset();
  document.querySelector("#tipo").value = selectedCollection;
  setPhoto("");
  photoUpload.value = "";
  photoCamera.value = "";
  formTitle.textContent = "Adicionar por foto";
  adaptFormForTipo(selectedCollection);
}

function renderStats(summary) {
  const set = (id, value) => {
    const el = document.querySelector(id);
    if (el) el.textContent = value;
  };
  set("#collectionTotal", summary.total);
  set("#collectionBones", summary.por_tipo.bone || 0);
  set("#collectionCamisas", summary.por_tipo.camisa || 0);
  set("#collectionOculos", summary.por_tipo.oculos || 0);
}

function cardMeta(item) {
  const parts = [item.time || item.marca, item.ano].filter(Boolean);
  return parts.join(" · ");
}

function modalField(label, value) {
  const v = value !== null && value !== undefined && String(value).trim();
  return `
    <div class="item-modal-field">
      <dt>${label}</dt>
      <dd>${v ? escapeHtml(String(value)) : "<span style='color:var(--faint)'>—</span>"}</dd>
    </div>`;
}

function openItemModal(item) {
  activeModalItem = item;
  // Exibe exatamente a foto gravada (foto_url) — sem reprocessar nem reorientar.
  itemModalPhoto.src = item.foto_url || placeholderFor(item.tipo);
  itemModalPhoto.alt = item.nome;

  const aut = item.autenticidade ?? "";
  itemModalBody.innerHTML = `
    <span class="badge">${normalizeTipo(item.tipo)}</span>
    <h2 class="item-modal-name">${escapeHtml(item.nome)}</h2>
    <div class="aut-selector">
      <button class="aut-btn ${aut === "" ? "active" : ""}" data-autenticidade="">—</button>
      <button class="aut-btn aut-original ${aut === "original" ? "active" : ""}" data-autenticidade="original">Original</button>
      <button class="aut-btn aut-replica ${aut === "replica" ? "active" : ""}" data-autenticidade="replica">Réplica</button>
    </div>
    <dl class="item-modal-fields">
      ${modalField("Marca", item.marca)}
      ${modalField("Time", item.time)}
      ${modalField("Cor", item.cor)}
      ${modalField("Tamanho", item.tamanho)}
      ${modalField("Ano", item.ano)}
      ${modalField("Local", item.localizacao)}
      ${modalField("Compra", item.data_compra)}
    </dl>
    ${item.observacoes ? `<p class="item-modal-obs">${escapeHtml(item.observacoes)}</p>` : ""}
  `;

  itemModalOverlay.classList.add("visible");
  document.body.style.overflow = "hidden";
}

function closeItemModal() {
  itemModalOverlay.classList.remove("visible");
  document.body.style.overflow = "";
  activeModalItem = null;
}

function renderItems(items) {
  currentItems = items;
  itemList.innerHTML = "";
  emptyState.classList.toggle("visible", items.length === 0);

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "item-card";
    card.dataset.id = item.id;
    const meta = cardMeta(item) || normalizeTipo(item.tipo);
    card.innerHTML = `
      <div class="item-photo-wrap">
        <img class="item-photo" src="${escapeHtml(item.foto_url || placeholderFor(item.tipo))}" alt="${escapeHtml(item.nome)}" loading="lazy">
        ${item.autenticidade === "replica" ? '<span class="replica-badge">Réplica</span>' : ""}
      </div>
      <div class="item-caption">
        <span class="item-name">${escapeHtml(item.nome)}</span>
        <span class="item-meta">${escapeHtml(meta)}</span>
      </div>
    `;
    itemList.appendChild(card);
  });
}

async function loadSummary() {
  const summary = await request("/api/resumo");
  renderStats(summary);
}

async function loadTimeFilter(tipo) {
  timeFilter.style.display = tipo === "camisa" ? "" : "none";
  if (tipo !== "camisa") { timeFilter.value = ""; return; }
  const times = await request(`/api/times?tipo=camisa`).catch(() => []);
  const current = timeFilter.value;
  timeFilter.innerHTML = '<option value="">Todos os times</option>' +
    times.map(t => `<option value="${escapeHtml(t)}"${t === current ? " selected" : ""}>${escapeHtml(t)}</option>`).join("");
}

async function loadItems() {
  const url = apiUrl("/api/itens", {
    tipo: tipoFilter.value,
    q: searchInput.value.trim(),
    autenticidade: autenticidadeFilter.value,
    time: timeFilter.value,
    ordem: ordemFilter.value,
  });
  const items = await request(url);
  renderItems(items);
}

async function refresh() {
  await Promise.all([loadSummary(), loadItems()]);
}

// ─── Event listeners ────────────────────────────

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = getPayload();
  const id = itemId.value;

  try {
    if (id) {
      await request(`/api/itens/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await request("/api/itens", { method: "POST", body: JSON.stringify(payload) });
    }
    resetForm();
    closeDrawer();
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

itemList.addEventListener("click", (event) => {
  const card = event.target.closest(".item-card[data-id]");
  if (card) {
    const id = Number(card.dataset.id);
    const item = currentItems.find((entry) => entry.id === id);
    if (item) openItemModal(item);
  }
});

itemModalBody.addEventListener("click", async (e) => {
  const btn = e.target.closest(".aut-btn[data-autenticidade]");
  if (!btn || !activeModalItem) return;
  const newVal = btn.dataset.autenticidade;
  const item = activeModalItem;
  if (newVal === (item.autenticidade ?? "")) return;

  itemModalBody.querySelectorAll(".aut-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  try {
    await request(`/api/itens/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...item, autenticidade: newVal }),
    });
    item.autenticidade = newVal;
    if (activeModalItem) activeModalItem.autenticidade = newVal;
    const stored = currentItems.find((i) => i.id === item.id);
    if (stored) stored.autenticidade = newVal;

    const card = document.querySelector(`.item-card[data-id="${item.id}"]`);
    const wrap = card && card.querySelector(".item-photo-wrap");
    if (wrap) {
      const existing = wrap.querySelector(".replica-badge");
      if (newVal === "replica" && !existing) {
        wrap.insertAdjacentHTML("beforeend", '<span class="replica-badge">Réplica</span>');
      } else if (newVal !== "replica" && existing) {
        existing.remove();
      }
    }
  } catch (err) {
    alert(err.message);
    itemModalBody.querySelectorAll(".aut-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.autenticidade === (item.autenticidade ?? ""));
    });
  }
});

itemModalClose.addEventListener("click", closeItemModal);
itemModalOverlay.addEventListener("click", (e) => {
  if (e.target === itemModalOverlay) closeItemModal();
});

itemModalEditBtn.addEventListener("click", () => {
  if (!activeModalItem) return;
  const item = activeModalItem;
  closeItemModal();
  fillForm(item);
});

itemModalRotateBtn.addEventListener("click", async () => {
  if (!activeModalItem) return;
  const item = activeModalItem;
  try {
    itemModalRotateBtn.textContent = "...";
    const result = await request(`/api/itens/${item.id}/rotar-foto`, { method: "POST" });
    item.foto_url = result.url;
    if (activeModalItem) activeModalItem.foto_url = result.url;
    const stored = currentItems.find((i) => i.id === item.id);
    if (stored) stored.foto_url = result.url;
    itemModalPhoto.src = result.url;
    const card = document.querySelector(`.item-card[data-id="${item.id}"] .item-photo`);
    if (card) card.src = result.url;
  } catch (error) {
    alert(error.message);
  } finally {
    itemModalRotateBtn.textContent = "↻";
  }
});

itemModalDeleteBtn.addEventListener("click", async () => {
  if (!activeModalItem) return;
  const id = activeModalItem.id;
  const ok = confirm("Excluir este item da colecao?");
  if (!ok) return;
  try {
    await request(`/api/itens/${id}`, { method: "DELETE" });
    closeItemModal();
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

[searchInput, autenticidadeFilter, ordemFilter].forEach((element) => {
  element.addEventListener("input", loadItems);
});

timeFilter.addEventListener("change", loadItems);

cancelEditBtn.addEventListener("click", () => {
  resetForm();
  closeDrawer();
});

newItemBtn.addEventListener("click", () => {
  resetForm();
  openDrawer("cadastro");
});

drawerOverlay.addEventListener("click", () => {
  closeDrawer();
});

bottomNavBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const nav = btn.dataset.nav;
    if (nav === "lista") {
      closeDrawer();
    } else if (nav === "adicionar") {
      resetForm();
      openDrawer("cadastro");
    } else if (nav === "verificar") {
      openDrawer("verificar");
    }
  });
});

const verificarTopBtn = document.querySelector("#verificarTopBtn");
if (verificarTopBtn) {
  verificarTopBtn.addEventListener("click", () => openDrawer("verificar"));
}

document.querySelector("#tipo").addEventListener("change", (e) => {
  selectedCollection = e.target.value;
  verifyTipo.value = e.target.value;
  selectedCollectionLabel.textContent = `Coleção de ${collectionNames[e.target.value] || "itens"}`;
  adaptFormForTipo(e.target.value);
});

clearPhotoBtn.addEventListener("click", () => setPhoto(""));
identifyPhotoBtn.addEventListener("click", () => identifyPhoto());
checkCurrentPhotoBtn.addEventListener("click", verifyCurrentPhoto);
cadastroTab.addEventListener("click", () => setTab("cadastro"));
verificarTab.addEventListener("click", () => setTab("verificar"));
cameraButton.addEventListener("click", () => openDeviceCamera(uploadPhoto, photoCamera));
verifyCameraButton.addEventListener("click", () => openDeviceCamera(verifyPhoto, verifyCamera));
collectionButtons.forEach((button) => {
  button.addEventListener("click", () => setFilter(button.dataset.collection));
});

[photoUpload, photoCamera].forEach((input) => {
  input.addEventListener("change", async () => {
    try {
      if (input === photoUpload && input.files.length > 1) {
        await processBatch(input.files);
      } else {
        await uploadPhoto(input.files[0]);
      }
      input.value = "";
    } catch (error) {
      alert(error.message);
    }
  });
});

[verifyUpload, verifyCamera].forEach((input) => {
  input.addEventListener("change", async () => {
    await verifyPhoto(input.files[0]);
    input.value = "";
  });
});

costPill.textContent = `IA · US$ ${sessionCost.toFixed(6)}`;
setFormType("bone");
refresh()
  .then(() => setFilter(""))
  .catch((error) => alert(error.message));
