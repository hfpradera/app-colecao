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
const identifyPhotoBtn = document.querySelector("#identifyPhotoBtn");
const cadastroTab = document.querySelector("#cadastroTab");
const verificarTab = document.querySelector("#verificarTab");
const cadastroPanel = document.querySelector("#cadastroPanel");
const verificarPanel = document.querySelector("#verificarPanel");
const verifyTipo = document.querySelector("#verifyTipo");
const verifyUpload = document.querySelector("#verifyUpload");
const verifyCamera = document.querySelector("#verifyCamera");
const verifyPreview = document.querySelector("#verifyPreview");
const verifyResult = document.querySelector("#verifyResult");

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
      <rect width="640" height="360" fill="#eef4ff"/>
      <text x="50%" y="48%" text-anchor="middle" fill="#1858bd" font-family="Arial" font-size="34" font-weight="700">${label}</text>
      <text x="50%" y="59%" text-anchor="middle" fill="#687389" font-family="Arial" font-size="18">sem foto</text>
    </svg>
  `)}`;
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

async function uploadPhoto(file) {
  if (!file) return;

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
  setPhoto(data.url);
  await identifyPhoto();
  return data.url;
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
        tipo: document.querySelector("#tipo").value,
      }),
    });

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

function setTab(name) {
  const cadastro = name === "cadastro";
  cadastroTab.classList.toggle("active", cadastro);
  verificarTab.classList.toggle("active", !cadastro);
  cadastroPanel.classList.toggle("active", cadastro);
  verificarPanel.classList.toggle("active", !cadastro);
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
    renderVerifyResult(result);
  } catch (error) {
    verifyResult.innerHTML = `<strong>Nao consegui verificar.</strong><span>${escapeHtml(error.message)}</span>`;
  }
}

async function uploadRawPhoto(file) {
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

function fillForm(item) {
  itemId.value = item.id;
  fields.forEach((field) => {
    const element = document.querySelector(`#${field}`);
    element.value = item[field] ?? "";
  });
  setPhoto(item.foto_url);
  formTitle.textContent = "Editar item";
  document.querySelector("#formPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetForm() {
  itemId.value = "";
  form.reset();
  document.querySelector("#tipo").value = "bone";
  setPhoto("");
  photoUpload.value = "";
  photoCamera.value = "";
  formTitle.textContent = "Novo item";
}

function renderStats(summary) {
  document.querySelector("#totalItems").textContent = summary.total;
  document.querySelector("#totalBones").textContent = summary.por_tipo.bone || 0;
  document.querySelector("#totalCamisas").textContent = summary.por_tipo.camisa || 0;
  document.querySelector("#totalOculos").textContent = summary.por_tipo.oculos || 0;
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

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
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
  document.querySelector("#nome").focus();
});
clearPhotoBtn.addEventListener("click", () => setPhoto(""));
identifyPhotoBtn.addEventListener("click", () => identifyPhoto());
cadastroTab.addEventListener("click", () => setTab("cadastro"));
verificarTab.addEventListener("click", () => setTab("verificar"));

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

refresh().catch((error) => {
  alert(error.message);
});
