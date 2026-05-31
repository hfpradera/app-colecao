from __future__ import annotations

import base64
import json
import mimetypes
import os
import sqlite3
import shutil
import urllib.error
import urllib.request
from uuid import uuid4
from contextlib import contextmanager
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR.parent / "data"))
DB_PATH = DATA_DIR / "colecao.db"
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def load_dotenv() -> None:
    env_path = BASE_DIR.parent / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

TIPOS = {"bone", "camisa", "oculos"}
IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def get_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS itens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo TEXT NOT NULL,
                nome TEXT NOT NULL,
                marca TEXT DEFAULT '',
                time TEXT DEFAULT '',
                cor TEXT DEFAULT '',
                tamanho TEXT DEFAULT '',
                ano INTEGER,
                valor_pago REAL DEFAULT 0,
                estado TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'na colecao',
                localizacao TEXT DEFAULT '',
                data_compra TEXT DEFAULT '',
                foto_url TEXT DEFAULT '',
                observacoes TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )


class ItemIn(BaseModel):
    tipo: Literal["bone", "camisa", "oculos"]
    nome: str = Field(min_length=1, max_length=120)
    marca: str = Field(default="", max_length=80)
    time: str = Field(default="", max_length=80)
    cor: str = Field(default="", max_length=80)
    tamanho: str = Field(default="", max_length=40)
    ano: int | None = Field(default=None, ge=1900, le=2100)
    localizacao: str = Field(default="", max_length=120)
    data_compra: str = Field(default="", max_length=20)
    foto_url: str = Field(default="", max_length=500)
    observacoes: str = Field(default="", max_length=1000)

    @field_validator("nome", "marca", "time", "cor", "tamanho", "localizacao", "foto_url", "observacoes")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


class Item(ItemIn):
    id: int
    created_at: str
    updated_at: str


class IdentificarFotoIn(BaseModel):
    foto_url: str
    tipo: Literal["bone", "camisa", "oculos"] | None = None


class VerificarFotoIn(BaseModel):
    foto_url: str
    tipo: Literal["bone", "camisa", "oculos"] | None = None


app = FastAPI(title="Colecao App")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def row_to_item(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/itens", response_model=list[Item])
def listar_itens(
    tipo: str = Query(default=""),
    q: str = Query(default=""),
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []

    if tipo:
        if tipo not in TIPOS:
            raise HTTPException(status_code=400, detail="Tipo invalido.")
        clauses.append("tipo = ?")
        params.append(tipo)

    if q:
        clauses.append(
            """
            (
                nome LIKE ? OR marca LIKE ? OR time LIKE ? OR cor LIKE ?
                OR tamanho LIKE ? OR localizacao LIKE ? OR observacoes LIKE ?
            )
            """
        )
        like = f"%{q.strip()}%"
        params.extend([like] * 7)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM itens {where} ORDER BY updated_at DESC, id DESC",
            params,
        ).fetchall()

    return [row_to_item(row) for row in rows]


@app.post("/api/itens", response_model=Item, status_code=201)
def criar_item(item: ItemIn) -> dict[str, Any]:
    timestamp = now_iso()
    payload = item.model_dump()

    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO itens (
                tipo, nome, marca, time, cor, tamanho, ano, valor_pago,
                estado, status, localizacao, data_compra, foto_url,
                observacoes, created_at, updated_at
            )
            VALUES (
                :tipo, :nome, :marca, :time, :cor, :tamanho, :ano, :valor_pago,
                :estado, :status, :localizacao, :data_compra, :foto_url,
                :observacoes, :created_at, :updated_at
            )
            """,
            {
                **payload,
                "valor_pago": 0,
                "estado": "",
                "status": "na colecao",
                "created_at": timestamp,
                "updated_at": timestamp,
            },
        )
        row = conn.execute("SELECT * FROM itens WHERE id = ?", (cursor.lastrowid,)).fetchone()

    return row_to_item(row)


@app.put("/api/itens/{item_id}", response_model=Item)
def atualizar_item(item_id: int, item: ItemIn) -> dict[str, Any]:
    payload = item.model_dump()
    payload["updated_at"] = now_iso()
    payload["id"] = item_id

    with get_db() as conn:
        existing = conn.execute("SELECT id FROM itens WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Item nao encontrado.")

        conn.execute(
            """
            UPDATE itens
            SET tipo = :tipo,
                nome = :nome,
                marca = :marca,
                time = :time,
                cor = :cor,
                tamanho = :tamanho,
                ano = :ano,
                localizacao = :localizacao,
                data_compra = :data_compra,
                foto_url = :foto_url,
                observacoes = :observacoes,
                updated_at = :updated_at
            WHERE id = :id
            """,
            payload,
        )
        row = conn.execute("SELECT * FROM itens WHERE id = ?", (item_id,)).fetchone()

    return row_to_item(row)


@app.delete("/api/itens/{item_id}", status_code=204)
def excluir_item(item_id: int) -> None:
    with get_db() as conn:
        cursor = conn.execute("DELETE FROM itens WHERE id = ?", (item_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Item nao encontrado.")


@app.get("/api/resumo")
def resumo() -> dict[str, Any]:
    with get_db() as conn:
        total = conn.execute("SELECT COUNT(*) FROM itens").fetchone()[0]
        por_tipo = {
            row["tipo"]: row["total"]
            for row in conn.execute("SELECT tipo, COUNT(*) AS total FROM itens GROUP BY tipo").fetchall()
        }

    return {
        "total": total,
        "por_tipo": por_tipo,
    }


@app.post("/api/uploads")
def upload_foto(foto: UploadFile = File(...)) -> dict[str, str]:
    extension = IMAGE_TYPES.get(foto.content_type or "")
    if not extension:
        raise HTTPException(status_code=400, detail="Envie uma imagem JPG, PNG, WEBP ou GIF.")

    filename = f"{uuid4().hex}{extension}"
    destination = UPLOAD_DIR / filename

    with destination.open("wb") as output:
        shutil.copyfileobj(foto.file, output)

    return {"url": f"/uploads/{filename}"}


def output_text_from_response(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]

    chunks: list[str] = []
    for item in payload.get("output", []):
        for content in item.get("content", []):
            text = content.get("text")
            if isinstance(text, str):
                chunks.append(text)
    return "\n".join(chunks).strip()


def call_openai_identify(foto_url: str, tipo: str | None = None) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="Configure a variavel OPENAI_API_KEY para usar a identificacao por IA.",
        )

    if not foto_url.startswith("/uploads/"):
        raise HTTPException(status_code=400, detail="Use uma foto enviada pelo app antes de identificar.")

    image_path = (UPLOAD_DIR / foto_url.removeprefix("/uploads/")).resolve()
    if not image_path.is_file() or UPLOAD_DIR.resolve() not in image_path.parents:
        raise HTTPException(status_code=404, detail="Foto nao encontrada.")

    mime_type = mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    data_url = f"data:{mime_type};base64,{encoded}"
    tipo_hint = f"O tipo informado no app e: {tipo}." if tipo else ""

    request_payload = {
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "Analise a foto de uma colecao pessoal de bones, camisas de times e oculos. "
                            f"{tipo_hint} "
                            "Retorne somente JSON valido com as chaves: nome, marca, time, cor, ano, observacoes. "
                            "Se nao tiver certeza, use texto curto e deixe campos desconhecidos como string vazia. "
                            "O campo nome deve ser uma boa descricao curta para cadastro."
                        ),
                    },
                    {"type": "input_image", "image_url": data_url, "detail": "low"},
                ],
            }
        ],
    }

    req = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(request_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"Erro da OpenAI: {message[:300]}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Nao foi possivel conectar a OpenAI: {exc.reason}") from exc

    raw_text = output_text_from_response(response_payload)
    try:
        suggestion = json.loads(raw_text)
    except json.JSONDecodeError:
        suggestion = {"nome": raw_text}

    return {
        "nome": str(suggestion.get("nome", "")).strip(),
        "marca": str(suggestion.get("marca", "")).strip(),
        "time": str(suggestion.get("time", "")).strip(),
        "cor": str(suggestion.get("cor", "")).strip(),
        "ano": suggestion.get("ano") or None,
        "observacoes": str(suggestion.get("observacoes", "")).strip(),
    }


@app.post("/api/identificar-foto")
def identificar_foto(payload: IdentificarFotoIn) -> dict[str, Any]:
    return call_openai_identify(payload.foto_url, payload.tipo)


def norm(value: Any) -> str:
    return " ".join(str(value or "").lower().strip().split())


def score_match(suggestion: dict[str, Any], item: dict[str, Any]) -> float:
    fields = ["nome", "marca", "time", "cor", "tamanho"]
    pairs = [(norm(suggestion.get(field)), norm(item.get(field))) for field in fields]
    usable = [(left, right) for left, right in pairs if left and right]
    if not usable:
        return 0

    ratios = [SequenceMatcher(None, left, right).ratio() for left, right in usable]
    if norm(suggestion.get("nome")) and norm(item.get("nome")):
        ratios.append(SequenceMatcher(None, norm(suggestion["nome"]), norm(item["nome"])).ratio() * 1.3)
    return min(1, sum(ratios) / len(ratios))


@app.post("/api/verificar-foto")
def verificar_foto(payload: VerificarFotoIn) -> dict[str, Any]:
    suggestion = call_openai_identify(payload.foto_url, payload.tipo)

    with get_db() as conn:
        if payload.tipo:
            rows = conn.execute("SELECT * FROM itens WHERE tipo = ?", (payload.tipo,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM itens").fetchall()

    scored = []
    for row in rows:
        item = row_to_item(row)
        score = score_match(suggestion, item)
        if score >= 0.45:
            scored.append({**item, "score": round(score, 2)})

    scored.sort(key=lambda item: item["score"], reverse=True)
    matches = scored[:5]

    return {
        "existe": bool(matches and matches[0]["score"] >= 0.62),
        "sugestao": suggestion,
        "matches": matches,
    }
