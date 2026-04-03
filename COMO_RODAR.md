# Como Rodar o Aprova.AI

## Pré-requisitos
- Node.js 20+
- MySQL rodando localmente (porta 3306)
- Banco de dados `aprova_ai` criado

## 1. Configurar banco de dados

```sql
CREATE DATABASE aprova_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 2. Backend

```bash
cd backend

# Instalar dependências (já feito)
npm install

# Gerar o client Prisma
npm run db:generate

# Criar as tabelas
npm run db:push

# Popular com dados de demonstração
npm run db:seed

# Iniciar em desenvolvimento
npm run dev
```

Backend rodará em: http://localhost:3001

## 3. Frontend

```bash
cd frontend

# Instalar dependências (já feito)
npm install

# Iniciar em desenvolvimento
npm run dev
```

Frontend rodará em: http://localhost:3000

## 4. Search Service (Python) — Busca automática de disciplinas

Opcional mas recomendado para usar a busca automática de matérias na página "Meu Concurso".

**Pré-requisito:** Python 3.9+

```bash
cd search-service

# Instalar dependências
pip install -r requirements.txt

# Iniciar o serviço
python main.py
```

Ou usar o script rápido:
```bash
cd search-service
rodar.bat
```

Search service rodará em: http://localhost:3003

> Sem o search service, a busca de disciplinas usa o banco local de concursos como fallback.

## Login Demo
- Email: demo@aprovaai.com
- Senha: demo1234

## Estrutura de uploads (organizada)

```
backend/uploads/
├── pdfs/
│   └── {userId}/
│       └── {subjectId}/
│           └── arquivo.pdf
├── images/
│   └── {userId}/
│       └── {subjectId}/
│           └── imagem.jpg
└── audios/
    └── {userId}/
        └── {subjectId}/
            └── audio.webm
```
