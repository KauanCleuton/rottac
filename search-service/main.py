"""
Aprova.AI — Unified Intelligence Service
Combina:
  - Search Service: busca de disciplinas via DuckDuckGo
  - Decision Engine: motor de decisão adaptativo
  - Analysis Bot: análise de comportamento e desempenho
  - Execution Bot: reação a eventos em tempo real
Porta: 3003
"""

import asyncio
import re
import unicodedata
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from duckduckgo_search import DDGS

# Importa o motor de inteligência
from intelligence_engine import (
    decision_engine,
    analysis_bot,
    execution_bot,
    TodayDecisionRequest,
    ReplanRequest,
    ProfileAnalysisRequest,
    ReversePlanRequest,
    EventReactionRequest,
)

app = FastAPI(title="Aprova.AI Intelligence Service", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Banco de disciplinas ────────────────────────────────────────────────────

DISCIPLINAS_DB: dict[str, list[str]] = {
    "Língua Portuguesa": ["língua portuguesa", "lingua portuguesa", "português", "portugues",
                          "interpretação de texto", "interpretacao de texto", "gramática", "gramatica",
                          "redação", "redacao", "ortografia", "coesão"],
    "Matemática": ["matemática", "matematica", "aritmética", "aritmetica", "álgebra"],
    "Matemática Financeira": ["matemática financeira", "matematica financeira", "juros compostos",
                              "amortização", "amortizacao", "porcentagem"],
    "Raciocínio Lógico": ["raciocínio lógico", "raciocinio logico", "lógica", "logica",
                          "lógica matemática", "lógica de argumentação", "silogismo",
                          "proposições lógicas", "raciocínio lógico-matemático"],
    "Informática": ["informática", "informatica", "noções de informática",
                    "tecnologia da informação", "tecnologia da informacao",
                    "sistemas operacionais", "pacote office", "internet", "segurança digital"],
    "Atualidades": ["atualidades", "conhecimentos gerais", "atualidades do mercado",
                    "questões contemporâneas", "fatos recentes"],
    "Direito Constitucional": ["direito constitucional", "constitucional",
                               "constituição federal", "constituicao federal",
                               "direitos fundamentais", "organização do estado"],
    "Direito Administrativo": ["direito administrativo", "administrativo",
                               "atos administrativos", "licitação", "licitacao",
                               "agentes públicos", "processo administrativo"],
    "Direito Penal": ["direito penal", "penal", "crimes", "tipicidade", "culpabilidade",
                      "código penal", "codigo penal", "aplicação da pena"],
    "Direito Processual Penal": ["direito processual penal", "processo penal",
                                  "processual penal", "código de processo penal",
                                  "inquérito policial", "inquerito policial"],
    "Direito Civil": ["direito civil", "civil", "código civil", "pessoa jurídica",
                      "obrigações", "contratos", "responsabilidade civil"],
    "Direito Processual Civil": ["direito processual civil", "processo civil",
                                  "processual civil", "código de processo civil"],
    "Direito do Trabalho": ["direito do trabalho", "trabalhista", "clt",
                            "consolidação das leis do trabalho", "relação de emprego"],
    "Direito Processual do Trabalho": ["direito processual do trabalho", "processo do trabalho",
                                        "processual trabalhista", "reclamação trabalhista"],
    "Direito Tributário": ["direito tributário", "direito tributario", "tributário",
                           "tributario", "sistema tributário nacional", "tributos"],
    "Direito Financeiro": ["direito financeiro", "finanças públicas", "financas publicas",
                           "orçamento público", "lei de responsabilidade fiscal"],
    "Direito Previdenciário": ["direito previdenciário", "previdenciário", "previdência social",
                               "previdencia social", "rgps", "rpps", "benefícios previdenciários"],
    "Legislação Tributária Federal": ["legislação tributária federal", "legislacao tributaria",
                                       "código tributário nacional", "ctn"],
    "Legislação de Trânsito": ["legislação de trânsito", "código de trânsito",
                                "ctb", "código de transito", "infrações de trânsito",
                                "educação para o trânsito"],
    "Legislação Especial": ["legislação especial", "leis especiais", "lei maria da penha",
                            "estatuto da criança", "eca", "lei de drogas", "legislação antidrogas"],
    "Controle Externo": ["controle externo", "fiscalização", "tribunal de contas"],
    "Contabilidade Geral": ["contabilidade geral", "contabilidade", "balanço patrimonial",
                            "demonstrações contábeis", "regime de competência"],
    "Contabilidade Pública": ["contabilidade pública", "contabilidade publica",
                              "siafi", "execução orçamentária", "lei 4320"],
    "Administração Pública": ["administração pública", "administracao publica",
                              "gestão pública", "reforma administrativa", "decreto lei 200"],
    "Administração Financeira": ["administração financeira", "gestão financeira",
                                  "orçamento público", "loa", "ldo", "ppa"],
    "Economia": ["economia", "microeconomia", "macroeconomia", "teoria econômica",
                 "mercado de trabalho", "indicadores econômicos"],
    "Estatística": ["estatística", "estatistica", "probabilidade",
                    "amostragem", "medidas de tendência central", "desvio padrão"],
    "Matemática Atuarial": ["matemática atuarial", "atuarial", "cálculo atuarial"],
    "Conhecimentos Bancários": ["conhecimentos bancários", "conhecimentos bancarios",
                                 "sistema financeiro nacional", "sfn", "banco central",
                                 "mercado de capitais", "produtos bancários"],
    "Criminologia": ["criminologia", "medicina legal", "vitimologia", "prevenção criminal"],
    "Medicina Legal": ["medicina legal", "tanatologia", "traumatologia forense",
                       "toxicologia", "sexologia forense"],
    "Física": ["física", "fisica", "mecânica", "termodinâmica", "eletricidade"],
    "Química": ["química", "quimica", "química orgânica", "reações químicas"],
    "Biologia": ["biologia", "ciências biológicas", "genética", "ecologia"],
    "Programação": ["programação", "programacao", "algoritmos", "desenvolvimento de software",
                    "linguagem de programação", "python", "java", "javascript"],
    "Banco de Dados": ["banco de dados", "sql", "sgbd", "postgresql", "mysql",
                       "modelagem de dados", "normalização"],
    "Redes de Computadores": ["redes de computadores", "redes", "tcp/ip", "protocolo",
                               "infraestrutura de redes", "switch", "roteador"],
    "Segurança da Informação": ["segurança da informação", "seguranca da informacao",
                                 "cibersegurança", "criptografia", "vulnerabilidades"],
    "Ética no Serviço Público": ["ética", "etica", "conduta", "ética no serviço público",
                                  "código de ética", "probidade administrativa",
                                  "lei de improbidade"],
    "Gestão de Pessoas": ["gestão de pessoas", "recursos humanos", "desenvolvimento humano"],
    "Redação Oficial": ["redação oficial", "correspondência oficial",
                        "manual de redação", "comunicação oficial"],
    "Noções de Direito Penal": ["noções de direito penal", "nocoes de direito penal",
                                 "crimes em espécie"],
    "Noções de Direito Administrativo": ["noções de direito administrativo",
                                          "nocoes de direito administrativo"],
    "Regulação de Transportes": ["regulação de transportes", "transportes terrestres",
                                  "concessão de rodovias"],
    "Direito das Telecomunicações": ["direito das telecomunicações", "telecomunicações",
                                      "regulação de telecomunicações"],
    "Direito Ambiental": ["direito ambiental", "meio ambiente", "legislação ambiental",
                          "política nacional do meio ambiente"],
    "Direito Eleitoral": ["direito eleitoral", "código eleitoral", "eleições", "partidos políticos"],
    "Direito Empresarial": ["direito empresarial", "direito comercial", "sociedades empresariais"],
    "Geopolítica": ["geopolítica", "relações internacionais", "política externa"],
    "Conhecimentos Específicos": ["conhecimentos específicos", "conhecimentos especificos",
                                   "área específica", "cargo específico"],
}

# ─── Detecção de concurso estadual ──────────────────────────────────────────

ESTADOS = {
    'AC': 'Acre', 'AL': 'Alagoas', 'AP': 'Amapá', 'AM': 'Amazonas',
    'BA': 'Bahia', 'CE': 'Ceará', 'DF': 'Distrito Federal', 'ES': 'Espírito Santo',
    'GO': 'Goiás', 'MA': 'Maranhão', 'MT': 'Mato Grosso', 'MS': 'Mato Grosso do Sul',
    'MG': 'Minas Gerais', 'PA': 'Pará', 'PB': 'Paraíba', 'PR': 'Paraná',
    'PE': 'Pernambuco', 'PI': 'Piauí', 'RJ': 'Rio de Janeiro', 'RN': 'Rio Grande do Norte',
    'RS': 'Rio Grande do Sul', 'RO': 'Rondônia', 'RR': 'Roraima',
    'SC': 'Santa Catarina', 'SP': 'São Paulo', 'SE': 'Sergipe', 'TO': 'Tocantins',
}

# Disciplinas padrão para concursos policiais estaduais
PM_DISCIPLINAS_PADRAO = [
    "Língua Portuguesa", "Matemática", "Raciocínio Lógico",
    "Direito Constitucional", "Direito Administrativo",
    "Direito Penal", "Direito Processual Penal",
    "Legislação Especial", "Atualidades", "Informática",
    "Noções de Direito Penal",
]

PC_DISCIPLINAS_PADRAO = [
    "Língua Portuguesa", "Matemática", "Raciocínio Lógico",
    "Direito Constitucional", "Direito Administrativo",
    "Direito Penal", "Direito Processual Penal",
    "Criminologia", "Medicina Legal", "Atualidades", "Informática",
    "Legislação Especial",
]

BOMBEIROS_DISCIPLINAS_PADRAO = [
    "Língua Portuguesa", "Matemática", "Raciocínio Lógico",
    "Direito Constitucional", "Direito Administrativo",
    "Física", "Química", "Biologia", "Atualidades", "Informática",
]

FISCAL_TRIBUTARIO_PADRAO = [
    "Direito Tributário", "Direito Constitucional", "Direito Administrativo",
    "Contabilidade Geral", "Economia", "Administração Financeira",
    "Matemática", "Matemática Financeira", "Língua Portuguesa", "Raciocínio Lógico",
]

def normalizar(texto: str) -> str:
    nfkd = unicodedata.normalize('NFKD', texto)
    return ''.join([c for c in nfkd if not unicodedata.combining(c)]).lower()

def detectar_padrao_concurso(concurso_norm: str) -> list[str] | None:
    """Detecta padrão de concurso por palavras-chave e retorna disciplinas padrão."""
    if any(p in concurso_norm for p in ['policia militar', 'pm ', ' pm', 'soldado', 'cabo pm', 'sargento pm']):
        return PM_DISCIPLINAS_PADRAO
    if any(p in concurso_norm for p in ['policia civil', 'pc ', 'investigador', 'escrivao', 'delegado', 'agente policial']):
        return PC_DISCIPLINAS_PADRAO
    if any(p in concurso_norm for p in ['bombeiro', 'cbm', 'corpo de bombeiro']):
        return BOMBEIROS_DISCIPLINAS_PADRAO
    if any(p in concurso_norm for p in ['fiscal', 'sefaz', 'receita estadual', 'auditor fiscal']):
        return FISCAL_TRIBUTARIO_PADRAO
    return None

def extrair_estado_da_query(concurso: str) -> str:
    """Extrai o nome/sigla do estado da query para melhorar a busca."""
    concurso_upper = concurso.upper()
    for sigla, nome in ESTADOS.items():
        if sigla in concurso_upper or nome.upper() in concurso_upper or normalizar(nome) in normalizar(concurso):
            return nome
    return ''

def extrair_disciplinas(textos: list[str]) -> list[dict]:
    """Extrai disciplinas dos textos, retorna lista com scores de confiança."""
    texto_completo = normalizar(" ".join(textos))
    resultado: dict[str, int] = {}

    for disciplina, variacoes in DISCIPLINAS_DB.items():
        score = 0
        for variacao in variacoes:
            variacao_norm = normalizar(variacao)
            ocorrencias = len(re.findall(re.escape(variacao_norm), texto_completo))
            score += ocorrencias
        if score > 0:
            resultado[disciplina] = score

    ordenado = sorted(resultado.items(), key=lambda x: x[1], reverse=True)
    return [
        {"nome": disc, "confianca": min(100, score * 15)}
        for disc, score in ordenado
    ]

# ─── Models ──────────────────────────────────────────────────────────────────

class BuscarRequest(BaseModel):
    concurso: str
    banca: Optional[str] = ""

class BuscarResponse(BaseModel):
    disciplinas: list[dict]
    fonte: str
    total: int
    padrao_detectado: Optional[str] = None

# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "aprova-ai-search", "version": "1.1.0"}

@app.post("/buscar-disciplinas", response_model=BuscarResponse)
async def buscar_disciplinas(req: BuscarRequest):
    concurso = req.concurso.strip()
    banca = (req.banca or "").strip()

    if not concurso:
        return BuscarResponse(disciplinas=[], fonte="erro", total=0)

    concurso_norm = normalizar(concurso)
    estado = extrair_estado_da_query(concurso)

    # 1) Tenta detectar padrão por tipo de concurso (PM, PC, Bombeiros, etc.)
    padrao = detectar_padrao_concurso(concurso_norm)
    padrao_nome = None
    if padrao:
        tipo = "PM" if "policia militar" in concurso_norm or "pm " in concurso_norm or "soldado" in concurso_norm else \
               "PC" if "policia civil" in concurso_norm or "delegado" in concurso_norm else \
               "Bombeiros" if "bombeiro" in concurso_norm else "Fiscal"
        padrao_nome = tipo

    # 2) Monta queries de busca para a web
    queries = [
        f"{concurso} {banca} edital disciplinas matérias conteúdo programático".strip(),
        f"concurso {concurso} {estado} matérias {banca} 2024 2025".strip(),
    ]

    textos_coletados: list[str] = []
    loop = asyncio.get_event_loop()

    def buscar_ddg(query: str) -> list[str]:
        resultados = []
        try:
            with DDGS() as ddgs:
                for r in ddgs.text(query, region='br-pt', safesearch='off', max_results=10):
                    body = r.get('body', '')
                    title = r.get('title', '')
                    resultados.append(f"{title} {body}")
        except Exception:
            pass
        return resultados

    for query in queries[:2]:
        textos = await loop.run_in_executor(None, buscar_ddg, query)
        textos_coletados.extend(textos)

    # 3) Extrai disciplinas dos textos
    disciplinas_web: list[dict] = []
    if textos_coletados:
        disciplinas_web = extrair_disciplinas(textos_coletados)

    # 4) Combina: se encontrou na web, usa. Se não encontrou suficiente, complementa com padrão.
    if len(disciplinas_web) >= 5:
        return BuscarResponse(
            disciplinas=disciplinas_web,
            fonte="web",
            total=len(disciplinas_web),
            padrao_detectado=padrao_nome,
        )

    # Fallback: padrão detectado por tipo
    if padrao:
        disciplinas_fallback = [{"nome": d, "confianca": 70} for d in padrao]
        # Adiciona os da web que não estão no padrão
        nomes_padrao = {d["nome"] for d in disciplinas_fallback}
        for d in disciplinas_web:
            if d["nome"] not in nomes_padrao:
                disciplinas_fallback.append(d)

        return BuscarResponse(
            disciplinas=disciplinas_fallback,
            fonte="padrao_detectado",
            total=len(disciplinas_fallback),
            padrao_detectado=padrao_nome,
        )

    # Ultimo fallback: retorna o que achou na web mesmo sendo pouco
    if disciplinas_web:
        return BuscarResponse(disciplinas=disciplinas_web, fonte="web_parcial", total=len(disciplinas_web))

    return BuscarResponse(disciplinas=[], fonte="sem_resultados", total=0)

@app.get("/disciplinas-lista")
async def listar_todas():
    return {"disciplinas": sorted(DISCIPLINAS_DB.keys()), "total": len(DISCIPLINAS_DB)}


# ═══════════════════════════════════════════════════════════════════════════
# ─── INTELLIGENCE ENGINE ENDPOINTS ─────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

# ─── Decision Engine ──────────────────────────────────────────────────────

@app.post("/decide/today")
async def decide_today(request: TodayDecisionRequest):
    """
    Gera o plano inteligente do dia.

    Algoritmo:
    - Detecta modo atual (normal, guerra, força bruta, cansado, retorno)
    - Prioriza disciplinas por score composto (fraqueza + peso + esquecimento)
    - Monta sequência de ações adaptada ao horário e energia
    - Insere revisões obrigatórias e micro-ação de consistência

    Regras principais:
    - accuracy < 50% + modo normal → tarefa marcada como [CRITICO]
    - modo GUERRA → apenas simulados + revisão, zero tópico novo
    - modo FORCA_BRUTA → 3 blocos da disciplina crítica, bloqueia outras
    - modo CANSADO → tarefas de 10-20min, nenhuma cognitiva pesada
    - modo RETORNO → plano gradual, foco em reconstruir hábito
    """
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, decision_engine.generate_today_plan, request)
    return result


@app.post("/decide/replan")
async def decide_replan(request: ReplanRequest):
    """
    Replanejar DURANTE o dia quando há atraso ou mudança de situação.

    Algoritmo:
    - Calcula tempo restante até 22h
    - Identifica deficit de tempo
    - Comprime tarefas longas (reduz até -40min)
    - Remove tarefas de baixa prioridade
    - Garante micro-ação no final (nunca removida)
    - Agenda tarefas removidas para amanhã
    """
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, execution_bot.react_to_event,
                                        type("R", (), {"eventType": "REPLAN", "context": {}, "profile": request.profile})())
    result = await loop.run_in_executor(None, decision_engine.replan_intraday, request)
    return result


@app.post("/decide/reverse-plan")
async def decide_reverse_plan(request: ReversePlanRequest):
    """
    Planejamento reverso baseado na data da prova.

    Fases:
    - > 90 dias: estudo amplo de todos os tópicos
    - 60-90 dias: aprofundamento nas fraquezas
    - 30-60 dias: revisão + questões intensivas (30/dia)
    - 15-30 dias: simulados semanais + revisão de erros
    - < 15 dias: MODO GUERRA — só revisão e simulados

    Calcula viabilidade do plano (% de conteúdo que consegue cobrir).
    """
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, decision_engine.generate_reverse_plan, request)
    return result


# ─── Analysis Bot ─────────────────────────────────────────────────────────

@app.post("/analyze/profile")
async def analyze_profile(request: ProfileAnalysisRequest):
    """
    Análise completa do perfil comportamental e de desempenho.

    Detecta:
    1. Fraquezas críticas (accuracy < 50%) → recomenda Força Bruta
    2. Consistência (dias estudados/30) → alerta se < 50%
    3. Horários produtivos reais (cruzamento energia + acerto)
    4. Taxa de retenção (flashcards) → ajuste da curva de revisão
    5. Padrão de procrastinação → classificação comportamental
    6. Padrão de erros (desatenção, interpretação, esquecimento)
    7. Risco de abandono (taxa de tarefas não concluídas)

    Classifica o usuário em: DISCIPLINADO | GUERREIRO | PROCRASTINADOR |
    INCONSISTENTE | ANSIOSO
    """
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, analysis_bot.analyze_profile, request)
    return result


# ─── Execution Bot — Reação a Eventos ─────────────────────────────────────

@app.post("/events/react")
async def react_to_event(request: EventReactionRequest):
    """
    Reage a eventos do usuário em tempo real.

    Eventos suportados e reações:
    - TAREFA_INICIADA → começa monitoramento de inatividade
    - TAREFA_CONCLUIDA → recompensa XP, dispara próxima ação
    - TAREFA_ABANDONADA → força micro-ação (< 5min gastos) ou replanejamento
    - TAREFA_PULADA → detecta padrão de fuga (3+ vezes = confronto)
    - INATIVIDADE_DETECTADA → alerta progressivo (30min/45min/60min+)
    - BAIXO_DESEMPENHO → muda estratégia ou ativa Força Bruta (< 40%)
    - ALTO_DESEMPENHO → reforço positivo, sugere avançar
    - SIMULADO_CONCLUIDO → revisão obrigatória dos erros
    - RETORNO_APOS_AUSENCIA → modo Retorno se > 14 dias
    - SESSAO_ENCERRADA → resumo + preparação para amanhã
    """
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, execution_bot.react_to_event, request)
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=3003, reload=True)
