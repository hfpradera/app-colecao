# Colecao App

Programa independente para administrar sua colecao de bones, camisas de times e oculos.

## Recursos

- Cadastro, edicao e exclusao de itens.
- Filtros por tipo e busca por texto.
- Resumo com total de itens e contagem por categoria.
- Upload de fotos e captura pela camera do celular.
- Identificacao por IA para sugerir nome e detalhes a partir da foto.
- Aba `Verificar foto` para enviar uma imagem e descobrir se o item ja parece existir na colecao.
- Banco SQLite local em `data/colecao.db`.
- Interface web simples, pronta para rodar em Docker.

## Como rodar com Docker

```powershell
docker compose up --build
```

Depois acesse:

```text
http://localhost:3010
```

## Como rodar sem Docker

```powershell
Copy-Item .env.example .env
# Edite o arquivo .env e coloque sua OPENAI_API_KEY
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 3010 --reload
```

## Como conectar a API do ChatGPT/OpenAI

1. Crie uma chave em `https://platform.openai.com/api-keys`.
2. Copie `.env.example` para `.env`.
3. No `.env`, troque `cole_sua_chave_aqui` pela sua chave real.
4. Reinicie o app.

O arquivo `.env` fica fora do Git para nao vazar sua chave. O app usa a variavel `OPENAI_API_KEY` para analisar as fotos pela API da OpenAI.

## Campos do cadastro

- Tipo: bone, camisa ou oculos.
- Nome, marca, time, cor, tamanho, ano, local, data de compra, foto e observacoes.
- Para usar a IA, configure a variavel `OPENAI_API_KEY`.
