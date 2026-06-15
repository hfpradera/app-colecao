from __future__ import annotations

import base64
import hashlib
import io
import json
import mimetypes
import os
import re
import sqlite3
import shutil
import urllib.error
import urllib.request
import unicodedata

from PIL import Image as PilImage, ImageOps
from uuid import uuid4
from contextlib import contextmanager
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR.parent / "data"))
DB_PATH = DATA_DIR / "colecao.db"
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
HASH_INDEX_PATH = DATA_DIR / "upload_hashes.json"


def load_hash_index() -> dict[str, str]:
    if HASH_INDEX_PATH.exists():
        try:
            return json.loads(HASH_INDEX_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def update_hash_index(file_hash: str, url: str) -> None:
    index = load_hash_index()
    index[file_hash] = url
    HASH_INDEX_PATH.write_text(json.dumps(index), encoding="utf-8")


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
OPENAI_INPUT_USD_PER_1M = float(os.getenv("OPENAI_INPUT_USD_PER_1M", "0.40"))
OPENAI_OUTPUT_USD_PER_1M = float(os.getenv("OPENAI_OUTPUT_USD_PER_1M", "1.60"))
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
ANTHROPIC_INPUT_USD_PER_1M = float(os.getenv("ANTHROPIC_INPUT_USD_PER_1M", "3.00"))
ANTHROPIC_OUTPUT_USD_PER_1M = float(os.getenv("ANTHROPIC_OUTPUT_USD_PER_1M", "15.00"))

TIPOS = {"bone", "camisa", "oculos"}
IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

TIME_ALIASES = {
    "clube de regatas do flamengo": "Flamengo",
    "cr flamengo": "Flamengo",
    "flamengo": "Flamengo",
    "selecao alemanha": "Alemanha",
    "selecao alema": "Alemanha",
    "alemanha": "Alemanha",
    "selecao argentina": "Argentina",
    "argentina": "Argentina",
    "selecao brasileira": "Brasil",
    "selecao do brasil": "Brasil",
    "brasil": "Brasil",
    "selecao espanhola": "Espanha",
    "selecao da espanha": "Espanha",
    "espanha": "Espanha",
    "selecao italiana": "Italia",
    "selecao da italia": "Italia",
    "italia": "Italia",
    "selecao da venezuela": "Venezuela",
    "selecao venezuelana": "Venezuela",
    "venezuela": "Venezuela",
}


def canonical_time(value: str) -> str:
    cleaned = " ".join(value.strip().split())
    key = unicodedata.normalize("NFKD", cleaned).encode("ascii", "ignore").decode("ascii").lower()
    return TIME_ALIASES.get(key, cleaned)


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
                autenticidade TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        try:
            conn.execute("ALTER TABLE itens ADD COLUMN autenticidade TEXT DEFAULT ''")
        except Exception:
            pass
        for row in conn.execute("SELECT id, time FROM itens WHERE time != ''").fetchall():
            normalized = canonical_time(row["time"])
            if normalized != row["time"]:
                conn.execute("UPDATE itens SET time = ? WHERE id = ?", (normalized, row["id"]))


class ItemIn(BaseModel):
    tipo: Literal["bone", "camisa", "oculos"]
    nome: str = Field(min_length=1, max_length=120)
    marca: str = Field(default="", max_length=80)
    time: str = Field(default="", max_length=80)
    cor: str = Field(default="", max_length=200)
    tamanho: str = Field(default="", max_length=40)
    ano: int | None = Field(default=None, ge=1900, le=2100)
    localizacao: str = Field(default="", max_length=120)
    data_compra: str = Field(default="", max_length=20)
    foto_url: str = Field(default="", max_length=500)
    observacoes: str = Field(default="", max_length=1000)
    autenticidade: Literal["original", "replica", ""] = Field(default="")

    @field_validator("nome", "marca", "cor", "tamanho", "localizacao", "foto_url", "observacoes")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("time")
    @classmethod
    def normalize_time(cls, value: str) -> str:
        return canonical_time(value)


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
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.middleware("http")
async def cache_headers(request: Request, call_next: Any) -> Response:
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/uploads/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path.startswith("/static/"):
        response.headers["Cache-Control"] = "public, max-age=3600"
    return response


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def row_to_item(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


_ORDER_MAP: dict[str, str] = {
    "updated": "updated_at DESC, id DESC",
    "added": "created_at DESC, id DESC",
    "az": "nome ASC",
    "za": "nome DESC",
}


@app.get("/api/times")
def listar_times(tipo: str = Query(default="camisa")) -> list[str]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT DISTINCT time FROM itens WHERE tipo = ? AND time != '' ORDER BY time ASC",
            (tipo,),
        ).fetchall()
    return sorted({canonical_time(row["time"]) for row in rows}, key=str.casefold)


@app.get("/api/itens", response_model=list[Item])
def listar_itens(
    tipo: str = Query(default=""),
    q: str = Query(default=""),
    autenticidade: str = Query(default=""),
    time_filter: str = Query(default="", alias="time"),
    ordem: str = Query(default="updated"),
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []

    if tipo:
        if tipo not in TIPOS:
            raise HTTPException(status_code=400, detail="Tipo invalido.")
        clauses.append("tipo = ?")
        params.append(tipo)

    if autenticidade in ("original", "replica"):
        clauses.append("autenticidade = ?")
        params.append(autenticidade)
    elif autenticidade == "nenhum":
        clauses.append("(autenticidade = '' OR autenticidade IS NULL)")

    if time_filter:
        clauses.append("time = ?")
        params.append(time_filter)

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
    order_clause = _ORDER_MAP.get(ordem, _ORDER_MAP["updated"])

    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM itens {where} ORDER BY {order_clause}",
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
                observacoes, autenticidade, created_at, updated_at
            )
            VALUES (
                :tipo, :nome, :marca, :time, :cor, :tamanho, :ano, :valor_pago,
                :estado, :status, :localizacao, :data_compra, :foto_url,
                :observacoes, :autenticidade, :created_at, :updated_at
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
                autenticidade = :autenticidade,
                updated_at = :updated_at
            WHERE id = :id
            """,
            payload,
        )
        row = conn.execute("SELECT * FROM itens WHERE id = ?", (item_id,)).fetchone()

    return row_to_item(row)


@app.delete("/api/itens/{item_id}", status_code=204, response_class=Response)
def excluir_item(item_id: int) -> Response:
    with get_db() as conn:
        cursor = conn.execute("DELETE FROM itens WHERE id = ?", (item_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Item nao encontrado.")
    return Response(status_code=204)


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


def _resize_if_needed(content: bytes, max_dim: int = 800) -> bytes:
    try:
        with PilImage.open(io.BytesIO(content)) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            if max(img.width, img.height) > max_dim:
                img.thumbnail((max_dim, max_dim), PilImage.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=88, optimize=True)
            return buf.getvalue()
    except Exception:
        return content


@app.post("/api/uploads")
def upload_foto(foto: UploadFile = File(...)) -> dict[str, Any]:
    extension = IMAGE_TYPES.get(foto.content_type or "")
    if not extension:
        raise HTTPException(status_code=400, detail="Envie uma imagem JPG, PNG, WEBP ou GIF.")

    content = foto.file.read()
    file_hash = hashlib.md5(content).hexdigest()

    hash_index = load_hash_index()
    if file_hash in hash_index:
        existing_url = hash_index[file_hash]
        existing_path = (UPLOAD_DIR / existing_url.removeprefix("/uploads/")).resolve()
        if existing_path.is_file():
            return {"url": existing_url, "already_exists": True}

    content = _resize_if_needed(content, max_dim=800)

    filename = f"{uuid4().hex}.jpg"
    destination = UPLOAD_DIR / filename
    destination.write_bytes(content)

    url = f"/uploads/{filename}"
    update_hash_index(file_hash, url)
    return {"url": url, "already_exists": False}


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


def parse_model_json(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {"nome": text}
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(text[start : end + 1])
                return parsed if isinstance(parsed, dict) else {"nome": text}
            except json.JSONDecodeError:
                pass
    return {"nome": text}


def usage_cost(payload: dict[str, Any]) -> dict[str, Any]:
    usage = payload.get("usage") or {}
    input_tokens = int(usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or input_tokens + output_tokens)
    cost_usd = (input_tokens * OPENAI_INPUT_USD_PER_1M + output_tokens * OPENAI_OUTPUT_USD_PER_1M) / 1_000_000
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "custo_usd": round(cost_usd, 6),
        "modelo": OPENAI_MODEL,
    }


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
    _TYPE_PROMPTS: dict[str, str] = {
        "bone": (
            "E um bone (cap/hat) de colecao. "
            "nome: nome oficial completo do modelo se reconhecivel (ex: 'Pirelli Podium Cap 2025 Singapore GP', "
            "'New Era 9FIFTY New York Yankees', '47 Brand Clean Up Boston Red Sox'). "
            "marca: fabricante (ex: New Era, 47 Brand, Adidas, Nike, Puma). "
            "time: time, evento ou tema do bone (ex: New York Yankees, Formula 1, Brasil). "
            "cor: cores principais. "
            "ano: ano de lancamento se visivel ou conhecido. "
            "observacoes: edicao especial, numero de serie, detalhes do bordado."
        ),
        "camisa": (
            "E uma camisa de time (jersey/kit) de colecao. Analise escudo, cores, fabricante, patrocinadores, gola, corte e tecnologia do tecido. "
            "time: OBRIGATORIO — identifique pelo escudo e cores. Nunca deixe vazio. "
            "marca: identifique o fabricante pelo logo (Adidas, Nike, Puma, Umbro, Castore, Reebok, Topper, Penalty, etc). "
            "ano: OBRIGATORIO — use o historico real de contratos entre fabricante e time para restringir o intervalo de anos possiveis, "
            "depois refine pelo design do kit, estilo da gola, patrocinador e tecnologia do tecido. "
            "Exemplos de historico: Adidas+Flamengo so a partir de 2013; Nike+Brasil ate 1996 e de 1997 em diante; "
            "Adidas+Selecao Brasileira nao existe; Umbro+Corinthians anos 90-2000s; Puma+Palmeiras so apos 2022. "
            "Use esse conhecimento para nunca retornar um ano impossivel para aquela combinacao time+fabricante. "
            "nome: time + mando em portugues + temporada (ex: 'Flamengo I 2013/14', 'Flamengo III 2023/24', 'Brasil I Copa do Mundo 1998', 'Real Madrid II 2023/24', 'Brasil Goleiro Copa do Mundo 1998'). "
            "Use I para titular, II para visitante, III para terceira. Para goleiro use 'Goleiro'. "
            "Se for camisa de Copa do Mundo ou Copa America, inclua o torneio no nome. "
            "Para estimar o ano: observe o numero de estrelas no escudo (Brasil: 4 estrelas = antes de 2002, 5 estrelas = 2002 em diante). "
            "cor: cores principais. "
            "observacoes: mando (titular/visitante/terceira/goleiro), jogador/numero visivel, patch de competicao, patrocinador principal, edicao especial."
        ),
        "oculos": (
            "E um oculos de colecao. A maioria e Ray-Ban ou Oakley — priorize essas marcas. "
            "RAY-BAN: identifique pelo logo metalico 'RB' na dobradura. Modelos principais: "
            "Wayfarer RB2140, New Wayfarer RB2132, Aviator RB3025/RB3026, Clubmaster RB3016, "
            "Round Metal RB3447, Justin RB4165, Erika RB4171, Hexagonal RB3548, Meteor RB2168, "
            "Caravan RB3136, Outdoorsman RB3030, Olympian RB3119. "
            "OAKLEY: identifique pelo logo 'O' ou escudo Oakley. Modelos principais: "
            "Holbrook OO9102, Frogskins OO9013, Sutro OO9406, Half Jacket OO9154, "
            "Flak 2.0 OO9188, Jawbreaker OO9290, RadarLock OO9206, Clifden OO9440, "
            "Latch OO9265, Split Shot OO9416, Targetline OO9397, Actuator OO9250. "
            "nome: marca + modelo + codigo + cor (ex: 'Ray-Ban Wayfarer RB2140 Black', "
            "'Oakley Holbrook OO9102 Polished Black Prizm', 'Ray-Ban Aviator RB3025 Gold Green'). "
            "marca: Ray-Ban ou Oakley (ou outra se claramente visivel). "
            "cor: cor da armacao e cor/tipo das lentes. "
            "observacoes: lente polarizada/Prizm/espelhada/degradê, material (acetato/metal/O Matter), "
            "formato (wayfarer/aviador/esportivo/redondo), edicao especial se houver."
        ),
    }

    tipo_instrucao = _TYPE_PROMPTS.get(tipo or "", (
        "E um item de colecao pessoal (bone, camisa de time ou oculos). "
        "Identifique com o maximo de especificidade possivel."
    ))

    use_web_search = False
    model = OPENAI_MODEL
    image_detail = "low"

    text_prompt = f"{tipo_instrucao} "
    if use_web_search:
        text_prompt += (
            "IMPORTANTE: antes de responder, use a busca web para identificar exatamente este item. "
            "Descreva os detalhes visuais que ve (escudo, logo do fabricante, cores, listras, gola, patch) "
            "e busque por esses detalhes para confirmar time, fabricante e temporada exatos. "
            "Nao confie na memoria — busque e confirme. "
        )
    text_prompt += (
        "Retorne somente JSON valido com as chaves: nome, marca, time, cor, ano, observacoes. "
        "Use o nome oficial/modelo exato. "
        "Nao use markdown, nao use bloco de codigo, nao escreva texto fora do JSON. "
        "Deixe campos desconhecidos como string vazia."
    )

    request_payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": text_prompt},
                    {"type": "input_image", "image_url": data_url, "detail": image_detail},
                ],
            }
        ],
    }
    if use_web_search:
        request_payload["tools"] = [{"type": "web_search_preview"}]

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
        timeout = 120 if tipo in ("camisa", "oculos") else 45
        with urllib.request.urlopen(req, timeout=timeout) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"Erro da OpenAI: {message[:300]}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Nao foi possivel conectar a OpenAI: {exc.reason}") from exc

    raw_text = output_text_from_response(response_payload)
    suggestion = parse_model_json(raw_text)

    nome = str(suggestion.get("nome", "")).strip()
    ano_raw = suggestion.get("ano")
    ano: int | None = None
    if ano_raw:
        try:
            ano = int(str(ano_raw).split("/")[0].strip())
        except (ValueError, TypeError):
            pass
    if not ano and nome:
        m = re.search(r"\b(19|20)\d{2}\b", nome)
        if m:
            ano = int(m.group())

    result = {
        "nome": nome,
        "marca": str(suggestion.get("marca", "")).strip(),
        "time": str(suggestion.get("time", "")).strip(),
        "cor": str(suggestion.get("cor", "")).strip(),
        "ano": ano,
        "observacoes": str(suggestion.get("observacoes", "")).strip(),
    }
    result["_uso"] = usage_cost(response_payload)
    return result


def _extract_result(suggestion: dict[str, Any]) -> dict[str, Any]:
    nome = str(suggestion.get("nome", "")).strip()
    ano_raw = suggestion.get("ano")
    ano: int | None = None
    if ano_raw:
        try:
            ano = int(str(ano_raw).split("/")[0].strip())
        except (ValueError, TypeError):
            pass
    if not ano and nome:
        m = re.search(r"\b(19|20)\d{2}\b", nome)
        if m:
            ano = int(m.group())
    return {
        "nome": nome,
        "marca": str(suggestion.get("marca", "")).strip(),
        "time": str(suggestion.get("time", "")).strip(),
        "cor": str(suggestion.get("cor", "")).strip(),
        "ano": ano,
        "observacoes": str(suggestion.get("observacoes", "")).strip(),
    }


def call_anthropic_identify(foto_url: str, tipo: str | None = None) -> dict[str, Any]:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="Configure a variavel ANTHROPIC_API_KEY para usar a identificacao por IA.",
        )

    if not foto_url.startswith("/uploads/"):
        raise HTTPException(status_code=400, detail="Use uma foto enviada pelo app antes de identificar.")

    image_path = (UPLOAD_DIR / foto_url.removeprefix("/uploads/")).resolve()
    if not image_path.is_file() or UPLOAD_DIR.resolve() not in image_path.parents:
        raise HTTPException(status_code=404, detail="Foto nao encontrada.")

    mime_type = mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")

    _TYPE_PROMPTS: dict[str, str] = {
        "bone": (
            "E um bone (cap/hat) de colecao. "
            "nome: nome oficial completo do modelo se reconhecivel (ex: 'Pirelli Podium Cap 2025 Singapore GP', "
            "'New Era 9FIFTY New York Yankees', '47 Brand Clean Up Boston Red Sox'). "
            "marca: fabricante (ex: New Era, 47 Brand, Adidas, Nike, Puma). "
            "time: time, evento ou tema do bone (ex: New York Yankees, Formula 1, Brasil). "
            "cor: cores principais. "
            "ano: ano de lancamento se visivel ou conhecido. "
            "observacoes: edicao especial, numero de serie, detalhes do bordado."
        ),
        "camisa": (
            "E uma camisa de time (jersey/kit) de colecao. Analise detalhadamente: escudo, cores, fabricante, "
            "patrocinadores, gola, corte, tecnologia do tecido e numero de estrelas no escudo. "
            "time: OBRIGATORIO — identifique pelo escudo e cores. Nunca deixe vazio. "
            "marca: fabricante pelo logo visivel (Adidas, Nike, Puma, Umbro, Castore, Kappa, Reebok, Topper, Penalty). "
            "ano: OBRIGATORIO — use o historico real de contratos fabricante+time para definir o intervalo possivel, "
            "depois refine pelo design, patrocinador, gola e tecnologia. "
            "Para o Brasil: 4 estrelas no escudo = antes de 2002; 5 estrelas = 2002 em diante. "
            "Adidas+Flamengo so a partir de 2013. Nike+Brasil desde 1997. Kappa+Vasco desde 2021. "
            "nome: time + mando em portugues + temporada "
            "(ex: 'Flamengo I 2013/14', 'Flamengo III 2023/24', 'Brasil Goleiro Copa do Mundo 1998', 'Real Madrid II 2023/24'). "
            "Use I=titular, II=visitante, III=terceira, Goleiro=goleiro. Se for Copa, inclua o torneio. "
            "cor: cores principais. "
            "observacoes: mando, jogador/numero visivel, patch de competicao, patrocinador principal."
        ),
        "oculos": (
            "E um oculos de colecao. A maioria e Ray-Ban ou Oakley — priorize essas marcas. "
            "RAY-BAN: identifique pelo logo metalico 'RB' na dobradura. Modelos principais: "
            "Wayfarer RB2140, New Wayfarer RB2132, Aviator RB3025/RB3026, Clubmaster RB3016, "
            "Round Metal RB3447, Justin RB4165, Erika RB4171, Hexagonal RB3548, Meteor RB2168, "
            "Caravan RB3136, Outdoorsman RB3030, Olympian RB3119. "
            "OAKLEY: identifique pelo logo 'O' ou escudo Oakley. Modelos principais: "
            "Holbrook OO9102, Frogskins OO9013, Sutro OO9406, Half Jacket OO9154, "
            "Flak 2.0 OO9188, Jawbreaker OO9290, RadarLock OO9206, Clifden OO9440, "
            "Latch OO9265, Split Shot OO9416, Targetline OO9397, Actuator OO9250. "
            "nome: marca + modelo + codigo + cor (ex: 'Ray-Ban Wayfarer RB2140 Black', "
            "'Oakley Holbrook OO9102 Polished Black Prizm', 'Ray-Ban Aviator RB3025 Gold Green'). "
            "marca: Ray-Ban ou Oakley (ou outra se claramente visivel). "
            "cor: cor da armacao e cor/tipo das lentes. "
            "observacoes: lente polarizada/Prizm/espelhada/degradê, material (acetato/metal/O Matter), "
            "formato (wayfarer/aviador/esportivo/redondo), edicao especial se houver."
        ),
    }

    tipo_instrucao = _TYPE_PROMPTS.get(tipo or "", (
        "E um item de colecao pessoal (bone, camisa de time ou oculos). "
        "Identifique com o maximo de especificidade possivel."
    ))

    text_prompt = (
        f"{tipo_instrucao} "
        "IMPORTANTE: todos os campos devem estar em PORTUGUES BRASILEIRO. "
        "NUNCA use palavras em ingles: use 'Goleiro' (nunca Goalkeeper), "
        "'Titular' ou 'I' (nunca Home), 'Visitante' ou 'II' (nunca Away), "
        "'Terceira' ou 'III' (nunca Third), 'Copa do Mundo' (nunca World Cup). "
        "Retorne somente JSON valido com as chaves: nome, marca, time, cor, ano, observacoes. "
        "Nao use markdown, nao use bloco de codigo, nao escreva texto fora do JSON. "
        "Deixe campos desconhecidos como string vazia."
    )

    request_payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 1024,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type,
                            "data": encoded,
                        },
                    },
                    {"type": "text", "text": text_prompt},
                ],
            }
        ],
    }

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(request_payload).encode("utf-8"),
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"Erro da Anthropic: {message[:300]}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Nao foi possivel conectar a Anthropic: {exc.reason}") from exc

    raw_text = ""
    for block in response_payload.get("content", []):
        if block.get("type") == "text":
            raw_text += block.get("text", "")

    suggestion = parse_model_json(raw_text.strip())
    usage = response_payload.get("usage", {})
    input_tokens = int(usage.get("input_tokens", 0))
    output_tokens = int(usage.get("output_tokens", 0))
    cost_usd = (input_tokens * ANTHROPIC_INPUT_USD_PER_1M + output_tokens * ANTHROPIC_OUTPUT_USD_PER_1M) / 1_000_000

    result = _extract_result(suggestion)
    result["_uso"] = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "custo_usd": round(cost_usd, 6),
        "modelo": ANTHROPIC_MODEL,
    }
    return result


def call_ai_identify(foto_url: str, tipo: str | None = None) -> dict[str, Any]:
    if tipo in ("camisa", "oculos") and os.getenv("ANTHROPIC_API_KEY"):
        return call_anthropic_identify(foto_url, tipo)
    return call_openai_identify(foto_url, tipo)


@app.post("/api/itens/{item_id}/rotar-foto")
def rotar_foto(item_id: int) -> dict[str, str]:
    with get_db() as conn:
        row = conn.execute("SELECT foto_url FROM itens WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item nao encontrado.")

    foto_url = row["foto_url"]
    if not foto_url or not foto_url.startswith("/uploads/"):
        raise HTTPException(status_code=400, detail="Item sem foto para rotar.")

    image_path = (UPLOAD_DIR / foto_url.removeprefix("/uploads/")).resolve()
    if not image_path.is_file() or UPLOAD_DIR.resolve() not in image_path.parents:
        raise HTTPException(status_code=404, detail="Foto nao encontrada.")

    try:
        with PilImage.open(image_path) as img:
            rotated = img.rotate(-90, expand=True).convert("RGB")
            buf = io.BytesIO()
            rotated.save(buf, format="JPEG", quality=88, optimize=True)
            new_content = buf.getvalue()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao rotar: {exc}") from exc

    new_filename = f"{uuid4().hex}.jpg"
    (UPLOAD_DIR / new_filename).write_bytes(new_content)
    new_url = f"/uploads/{new_filename}"

    update_hash_index(hashlib.md5(new_content).hexdigest(), new_url)

    with get_db() as conn:
        conn.execute(
            "UPDATE itens SET foto_url = ?, updated_at = ? WHERE id = ?",
            (new_url, now_iso(), item_id),
        )

    return {"url": new_url}


@app.post("/api/identificar-foto")
def identificar_foto(payload: IdentificarFotoIn) -> dict[str, Any]:
    return call_ai_identify(payload.foto_url, payload.tipo)


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
    suggestion = call_ai_identify(payload.foto_url, payload.tipo)

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
