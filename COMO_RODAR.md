# Como Rodar o Rotta Concursos (local)

## Pré-requisitos
- Node.js 20+
- Python 3.10+
- MySQL/MariaDB na porta 3306 (o MariaDB do XAMPP serve: `C:\xampp\mysql_start.bat`)
- Banco `aprova_ai` criado:

```sql
CREATE DATABASE aprova_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 1. Backend (porta 3001)

```bash
cd backend
npm install
cp .env.example .env        # ajuste DATABASE_URL e JWT_SECRET
npm run db:generate
npm run db:push              # cria/atualiza as tabelas
npm run db:assuntos          # árvore de matérias e assuntos (6.613 nós) + classifica questões existentes
npm run dev
```

> A árvore vem de `backend/prisma/data/assuntos.json`. Para atualizar a partir de um arquivo novo
> (no formato aninhado com `children`), rode `npm run db:assuntos -- "caminho/do/arquivo.txt"`:
> nomes e posições são atualizados sem duplicar nem perder o vínculo das questões.

No `.env` local, aponte para os serviços locais:

```
FRONTEND_URL="http://localhost:3000"
SEARCH_SERVICE_URL="http://localhost:3003"
INTELLIGENCE_SERVICE_URL="http://localhost:3003"
```

### Administrador e banco de questões

```bash
# 1. Crie sua conta pela tela de cadastro e depois promova-a a ADMIN
npm run make-admin -- seu@email.com

# 2. (opcional) Popule o banco com 8 questões de exemplo
npm run db:seed-questions -- seu@email.com
```

O admin cadastra questões em **Gerenciar Questões** (`/admin/questoes`) ou em **Criar Questão** (`/questoes/nova`)
e pode publicar no banco compartilhado. Alunos criam questões privadas.

### Planos e vendas

Na primeira execução o backend cria os planos **Free**, **Premium** e **RottaPapiro** (todos com preço zero)
e liga a opção **"Liberar tudo para todos"**. O admin gerencia tudo em:

- `/admin` — painel geral (alunos, receita, questões por dia)
- `/admin/planos` — planos, recursos/limites, cupons, promoções e a opção "liberar tudo"
- `/admin/vendas` — pedidos (confirmar pagamento, cancelar, estornar) e assinaturas
- `/admin/alunos` — alunos, plano, desempenho; conceder ou cancelar planos

Ainda não há gateway de pagamento: plano com preço zero ativa na hora; com preço, o pedido fica pendente até o admin confirmar.

### Ferramentas de estudo

- `/questoes/mais-cai` — assuntos mais cobrados por banca, com o acerto do aluno e caderno com o "top 10"
- `/edital-verticalizado` — o aluno cola o conteúdo programático; cada tópico é ligado à árvore de assuntos
- `/ciclo` — ciclo de estudos com cronômetro de horas líquidas e gráficos
- `/lei-seca` — leitura por artigo, marca-texto e questões de cada artigo (admin cadastra em `/admin/lei-seca`
  colando o texto do Planalto; questões que citam "art. N" são vinculadas automaticamente)
- `/simulados` — simulados com data marcada, ranking e nota de corte (admin cria em `/admin/simulados`)
- `/admin/curadoria` — fila de questões sem classificação, sem gabarito ou sem comentário

> `npm run db:seed` recria as disciplinas do usuário configurado no script (apaga as existentes) e exige `SEED_PASSWORD` no `.env`.

## 2. Frontend (porta 3000)

```bash
cd frontend
npm install
npm run dev
```

Acesse http://localhost:3000/auth/login

## 3. Serviço Python (porta 3003) — extração de PDF e inteligência

```bash
cd search-service
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe main.py
```

Sem ele, a importação de questões/flashcards por PDF não funciona.

## Estrutura de uploads

```
backend/uploads/
├── pdfs/{userId}/{subjectId}/arquivo.pdf
├── images/{userId}/{subjectId}/imagem.jpg
└── audios/{userId}/{subjectId}/audio.webm
```
