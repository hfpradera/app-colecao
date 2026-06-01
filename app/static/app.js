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
];

let currentItems = [];
let selectedCollection = "bone";
let sessionCost = Number(localStorage.getItem("aiSessionCost") || "0");

const collectionNames = {
  bone: "bones",
  camisa: "camisas",
  oculos: "oculos",
};

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
    bone: "Bone",
    camisa: "Camisa",
    oculos: "Oculos",
  }[tipo] || tipo;
}

function placeholderFor(tipo) {
  const label = normalizeTipo(tipo);
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
      <rect width="640" height="360" fill="#eff4ff"/>
      <text x="50%" y="48%" text-anchor="middle" fill="#124fc7" font-family="Arial" font-size="34" font-weight="700">${label}</text>
      <text x="50%" y="59%" text-anchor="middle" fill="#667085" font-family="Arial" font-size="18">sem foto</text>
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
  costPill.textContent = `IA: US$ ${sessionCost.toFixed(6)}`;
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

async function uploadRawPhoto(file) {
  if (!file) return "";
  const formData = new FormData();
  formData.append("foto", file);

  const response = await fetch("/api/uploads", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Nao foi possivel enviar a foto." }));
    throw new Error(error.detail || "Nao foi possivel enviar a foto.");
  }

  const data = await response.json();
  return data.url;
}

async function uploadPhoto(file) {
  const url = await uploadRawPhoto(file);
  if (!url) return "";
  setPhoto(url);
  await identifyPhoto();
  return url;
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
    const suggestion = await request("/api/identificar-foto", {
      method: "POST",
      body: JSON.stringify({
        foto_url: fotoUrl,
        tipo: selectedCollection,
      }),
    });

    ["nome", "marca", "time", "cor", "ano", "observacoes"].forEach((field) => {
      const value = suggestion[field];
      const element = document.querySelector(`#${field}`);
      if (value !== null && value !== undefined && String(value).trim()) {
        element.value = value;
      }
    });
    updateCost(suggestion._uso);
  } catch (error) {
    alert(error.message);
  } finally {
    identifyPhotoBtn.textContent = "IA";
    identifyPhotoBtn.classList.remove("loading");
  }
}

function setTab(name) {
  const cadastro = name === "cadastro";
  cadastroTab.classList.toggle("active", cadastro);
  verificarTab.classList.toggle("active", !cadastro);
  cadastroPanel.classList.toggle("active", cadastro);
  verificarPanel.classList.toggle("active", !cadastro);
}

function setCollection(tipo) {
  selectedCollection = tipo;
  document.querySelector("#tipo").value = tipo;
  tipoFilter.value = tipo;
  verifyTipo.value = tipo;
  selectedCollectionLabel.textContent = `Colecao de ${collectionNames[tipo]}`;
  collectionButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.collection === tipo);
  });
  loadItems().catch((error) => alert(error.message));
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
    const fotoUrl = await uploadRawPhoto(file);
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

  setTab("verificar");
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
  setCollection(item.tipo);
  fields.forEach((field) => {
    const element = document.querySelector(`#${field}`);
    element.value = item[field] ?? "";
  });
  setPhoto(item.foto_url);
  formTitle.textContent = "Editar item";
  setTab("cadastro");
  document.querySelector("#formPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetForm() {
  itemId.value = "";
  form.reset();
  document.querySelector("#tipo").value = selectedCollection;
  setPhoto("");
  photoUpload.value = "";
  photoCamera.value = "";
  formTitle.textContent = "Adicionar por foto";
}

function renderStats(summary) {
  document.querySelector("#totalItems").textContent = summary.total;
  document.querySelector("#totalBones").textContent = summary.por_tipo.bone || 0;
  document.querySelector("#totalCamisas").textContent = summary.por_tipo.camisa || 0;
  document.querySelector("#totalOculos").textContent = summary.por_tipo.oculos || 0;
  document.querySelector("#collectionBones").textContent = summary.por_tipo.bone || 0;
  document.querySelector("#collectionCamisas").textContent = summary.por_tipo.camisa || 0;
  document.querySelector("#collectionOculos").textContent = summary.por_tipo.oculos || 0;
}

function metaLine(item) {
  const parts = [
    item.marca,
    item.time,
    item.cor,
    item.tamanho,
    item.ano,
    item.localizacao,
  ].filter(Boolean);

  return parts.map((part) => `<span>${escapeHtml(String(part))}</span>`).join("");
}

function renderItems(items) {
  currentItems = items;
  itemList.innerHTML = "";
  emptyState.classList.toggle("visible", items.length === 0);

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "item-card";
    card.innerHTML = `
      <img class="item-photo" src="${escapeHtml(item.foto_url || placeholderFor(item.tipo))}" alt="">
      <div class="item-body">
        <div class="item-top">
          <div>
            <span class="badge">${normalizeTipo(item.tipo)}</span>
            <h3>${escapeHtml(item.nome)}</h3>
          </div>
        </div>
        <div class="item-meta">${metaLine(item)}</div>
        <p class="notes">${escapeHtml(item.observacoes || "")}</p>
        <div class="card-actions">
          <button type="button" data-action="edit" data-id="${item.id}">Editar</button>
          <button class="delete" type="button" data-action="delete" data-id="${item.id}">Excluir</button>
        </div>
      </div>
    `;
    itemList.appendChild(card);
  });
}

async function loadSummary() {
  const summary = await request("/api/resumo");
  renderStats(summary);
}

async function loadItems() {
  const url = apiUrl("/api/itens", {
    tipo: tipoFilter.value,
    q: searchInput.value.trim(),
  });
  const items = await request(url);
  renderItems(items);
}

async function refresh() {
  await Promise.all([loadSummary(), loadItems()]);
}

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
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

itemList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const id = Number(button.dataset.id);
  const item = currentItems.find((entry) => entry.id === id);

  if (button.dataset.action === "edit" && item) {
    fillForm(item);
  }

  if (button.dataset.action === "delete") {
    const ok = confirm("Excluir este item da colecao?");
    if (!ok) return;
    await request(`/api/itens/${id}`, { method: "DELETE" });
    await refresh();
  }
});

[searchInput, tipoFilter].forEach((element) => {
  element.addEventListener("input", loadItems);
});

cancelEditBtn.addEventListener("click", resetForm);
newItemBtn.addEventListener("click", () => {
  resetForm();
  setTab("cadastro");
  document.querySelector("#nome").focus();
});
clearPhotoBtn.addEventListener("click", () => setPhoto(""));
identifyPhotoBtn.addEventListener("click", () => identifyPhoto());
checkCurrentPhotoBtn.addEventListener("click", verifyCurrentPhoto);
cadastroTab.addEventListener("click", () => setTab("cadastro"));
verificarTab.addEventListener("click", () => setTab("verificar"));
cameraButton.addEventListener("click", () => openDeviceCamera(uploadPhoto, photoCamera));
verifyCameraButton.addEventListener("click", () => openDeviceCamera(verifyPhoto, verifyCamera));
collectionButtons.forEach((button) => {
  button.addEventListener("click", () => setCollection(button.dataset.collection));
});

[photoUpload, photoCamera].forEach((input) => {
  input.addEventListener("change", async () => {
    try {
      await uploadPhoto(input.files[0]);
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

costPill.textContent = `IA: US$ ${sessionCost.toFixed(6)}`;
refresh()
  .then(() => setCollection(selectedCollection))
  .catch((error) => alert(error.message));
