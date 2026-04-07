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
                    "linguagem de programação", "python", "java", "javascript", "c#", "c++",
                    "typescript", "orientação a objetos", "estruturas de dados", "complexidade",
                    "programação orientada a objetos", "poo"],
    "Desenvolvimento Web": ["desenvolvimento web", "html", "css", "javascript", "react",
                            "reactjs", "react.js", "nodejs", "node.js", "angular", "vue",
                            "frontend", "front-end", "backend", "back-end", "api rest",
                            "restful", "json", "xml", "web services"],
    "DevOps e Infraestrutura": ["devops", "docker", "kubernetes", "containers", "ci/cd",
                                 "integração contínua", "aws", "azure", "google cloud",
                                 "computação em nuvem", "cloud computing", "linux", "git",
                                 "versionamento", "pipeline", "terraform"],
    "Banco de Dados": ["banco de dados", "sql", "sgbd", "postgresql", "mysql", "oracle",
                       "mongodb", "nosql", "modelagem de dados", "normalização",
                       "stored procedures", "triggers", "indexação"],
    "Redes de Computadores": ["redes de computadores", "redes", "tcp/ip", "protocolo",
                               "infraestrutura de redes", "switch", "roteador", "firewall",
                               "vpn", "dns", "dhcp", "http", "osi", "ethernet"],
    "Segurança da Informação": ["segurança da informação", "seguranca da informacao",
                                 "cibersegurança", "criptografia", "vulnerabilidades",
                                 "owasp", "pentest", "lgpd", "privacidade", "soc"],
    "Engenharia de Software": ["engenharia de software", "metodologias ágeis", "scrum", "kanban",
                                "uml", "padrões de projeto", "design patterns", "solid",
                                "testes de software", "qualidade de software", "requisitos"],
    "Inteligência Artificial": ["inteligência artificial", "machine learning", "aprendizado de máquina",
                                 "deep learning", "redes neurais", "processamento de linguagem natural",
                                 "visão computacional", "ia", "data science", "ciência de dados"],
    "Sistemas Operacionais": ["sistemas operacionais", "linux", "windows server", "unix",
                               "processos", "threads", "gerenciamento de memória",
                               "sistema de arquivos", "virtualização"],
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

TI_GERAL_PADRAO = [
    "Programação", "Desenvolvimento Web", "Banco de Dados", "Redes de Computadores",
    "Segurança da Informação", "Engenharia de Software", "Sistemas Operacionais",
    "Informática", "Língua Portuguesa", "Raciocínio Lógico",
]

TI_DEVOPS_PADRAO = [
    "DevOps e Infraestrutura", "Redes de Computadores", "Segurança da Informação",
    "Sistemas Operacionais", "Banco de Dados", "Programação",
    "Informática", "Língua Portuguesa", "Raciocínio Lógico",
]

TI_IA_PADRAO = [
    "Inteligência Artificial", "Programação", "Estatística",
    "Banco de Dados", "Engenharia de Software", "Matemática",
    "Língua Portuguesa", "Raciocínio Lógico",
]

JUDICIARIO_GERAL_PADRAO = [
    "Língua Portuguesa", "Raciocínio Lógico", "Direito Constitucional",
    "Direito Administrativo", "Direito Civil", "Direito Processual Civil",
    "Ética no Serviço Público", "Noções de Administração Pública",
]

BANCARIO_PADRAO = [
    "Língua Portuguesa", "Matemática", "Raciocínio Lógico",
    "Conhecimentos Bancários", "Atualidades", "Economia",
    "Contabilidade Geral", "Matemática Financeira",
]

LEGISLATIVO_PADRAO = [
    "Língua Portuguesa", "Direito Constitucional", "Direito Administrativo",
    "Raciocínio Lógico", "Ética no Serviço Público", "Atualidades",
    "Redação Oficial",
]

def normalizar(texto: str) -> str:
    nfkd = unicodedata.normalize('NFKD', texto)
    return ''.join([c for c in nfkd if not unicodedata.combining(c)]).lower()

def detectar_padrao_concurso(concurso_norm: str) -> tuple[list[str] | None, str | None]:
    """
    Detecta padrão de concurso por palavras-chave.
    Retorna (lista_disciplinas, nome_padrao) ou (None, None).
    IMPORTANTE: só retorna padrão quando tem ALTA certeza do cargo.
    Jamais retorna padrão de Direito para cargos de TI.
    """
    # ─── TI / Tecnologia da Informação ──────────────────────────────────
    ti_keywords = [
        'ciencia da computacao', 'ciências da computação', 'analista de sistemas',
        'analista de ti', 'tecnologia da informacao', 'tecnologia da informação',
        'engenharia de software', 'desenvolvimento de sistemas', 'suporte de ti',
        'infraestrutura', 'redes e comunicacoes', 'seguranca da informacao',
        'banco de dados', 'programacao', 'desenvolvedor', 'analista de tecnologia',
        'ti ', ' ti ', 'sistemas de informacao', 'sistemas de informação',
    ]
    if any(p in concurso_norm for p in ti_keywords):
        # Sub-especialidades de TI
        if any(p in concurso_norm for p in ['devops', 'infraestrutura', 'redes', 'cloud']):
            return TI_DEVOPS_PADRAO, 'TI - DevOps/Infra'
        if any(p in concurso_norm for p in ['inteligencia artificial', 'machine learning', 'data', 'ciencia de dados']):
            return TI_IA_PADRAO, 'TI - IA/Data Science'
        return TI_GERAL_PADRAO, 'TI - Geral'

    # ─── Forças de segurança ────────────────────────────────────────────
    if any(p in concurso_norm for p in ['policia militar', 'soldado pm', 'cabo pm', 'sargento pm']):
        return PM_DISCIPLINAS_PADRAO, 'Polícia Militar'
    if any(p in concurso_norm for p in ['policia federal', 'pf -', 'agente federal', 'delegado federal']):
        return PC_DISCIPLINAS_PADRAO, 'Polícia Federal'
    if any(p in concurso_norm for p in ['policia civil', 'investigador', 'escrivao', 'delegado estadual']):
        return PC_DISCIPLINAS_PADRAO, 'Polícia Civil'
    if any(p in concurso_norm for p in ['bombeiro', 'cbm', 'corpo de bombeiro']):
        return BOMBEIROS_DISCIPLINAS_PADRAO, 'Corpo de Bombeiros'

    # ─── Fiscal/Tributário ──────────────────────────────────────────────
    if any(p in concurso_norm for p in ['fiscal', 'sefaz', 'receita estadual', 'auditor fiscal', 'receita federal']):
        return FISCAL_TRIBUTARIO_PADRAO, 'Fiscal/Tributário'

    # ─── Judiciário ──────────────────────────────────────────────────────
    if any(p in concurso_norm for p in ['judiciario', 'judiciário', 'tribunal', 'trf', 'tst', 'stj', 'stf', 'tjsp', 'tjrj', 'analista judiciario', 'tecnico judiciario']):
        # Analista Judiciário de TI tem padrão específico — já capturado acima
        # Para área administrativa/jurídica
        if any(p in concurso_norm for p in ['direito', 'juridico', 'juridica', 'execucao de mandados']):
            return JUDICIARIO_GERAL_PADRAO, 'Judiciário - Área Jurídica'
        # Área administrativa genérica
        if any(p in concurso_norm for p in ['administrativa', 'administrativo', 'contabilidade', 'financas']):
            return JUDICIARIO_GERAL_PADRAO, 'Judiciário - Área Administrativa'
        # Judiciário genérico — retorna padrão base
        return JUDICIARIO_GERAL_PADRAO, 'Judiciário'

    # ─── Bancário ────────────────────────────────────────────────────────
    if any(p in concurso_norm for p in ['banco do brasil', 'bb -', 'caixa economica', 'cef ', 'bradesco', 'itau', 'bndes', 'banco central']):
        return BANCARIO_PADRAO, 'Bancário'

    # ─── Legislativo ─────────────────────────────────────────────────────
    if any(p in concurso_norm for p in ['camara', 'câmara', 'senado', 'assembleia', 'legislativo']):
        return LEGISLATIVO_PADRAO, 'Legislativo'

    # Sem padrão identificado — deixa a busca web trabalhar
    return None, None

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
            # Para termos curtos (< 5 chars como "sql", "css", "ia"), usa \b para palavra inteira
            # Para termos longos, busca como substring (mais tolerante a variações)
            if len(variacao_norm) <= 5:
                pattern = r'\b' + re.escape(variacao_norm) + r'\b'
            else:
                pattern = re.escape(variacao_norm)
            ocorrencias = len(re.findall(pattern, texto_completo))
            score += ocorrencias * (2 if len(variacao_norm) > 10 else 1)  # termos longos valem mais
        if score > 0:
            resultado[disciplina] = score

    ordenado = sorted(resultado.items(), key=lambda x: x[1], reverse=True)
    return [
        {"nome": disc, "confianca": min(100, score * 10)}
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

    # 1) Detecta padrão específico do cargo/área
    padrao, padrao_nome = detectar_padrao_concurso(concurso_norm)

    # 2) Busca na web com queries específicas para o cargo
    # Inclui o cargo na query para não confundir disciplinas de áreas diferentes
    queries = [
        f"{concurso} {banca} edital conteúdo programático 2024 2025".strip(),
        f"concurso {concurso} {estado} matérias disciplinas edital".strip(),
        f'"{concurso}" conteúdo programático disciplinas'.strip(),
    ]

    textos_coletados: list[str] = []
    loop = asyncio.get_event_loop()

    def buscar_ddg(query: str) -> list[str]:
        resultados = []
        try:
            with DDGS() as ddgs:
                for r in ddgs.text(query, region='br-pt', safesearch='off', max_results=12):
                    body = r.get('body', '')
                    title = r.get('title', '')
                    resultados.append(f"{title} {body}")
        except Exception:
            pass
        return resultados

    # Executa as 3 queries
    for query in queries:
        textos = await loop.run_in_executor(None, buscar_ddg, query)
        textos_coletados.extend(textos)

    # 3) Extrai disciplinas dos textos
    disciplinas_web: list[dict] = []
    if textos_coletados:
        disciplinas_web = extrair_disciplinas(textos_coletados)

    # 4) Estratégia de combinação:
    # - Se web retornou >= 4 resultados → usa web como primário, complementa com padrão (sem duplicar)
    # - Se web retornou < 4 mas temos padrão → usa padrão + web
    # - Se web retornou < 4 e não há padrão → retorna o que tem da web
    # NUNCA adicionar padrão de área errada

    if len(disciplinas_web) >= 4:
        # Web domina — se há padrão compatível, adiciona disciplinas do padrão que a web não pegou
        if padrao:
            nomes_web = {d["nome"] for d in disciplinas_web}
            for disc_padrao in padrao:
                if disc_padrao not in nomes_web:
                    disciplinas_web.append({"nome": disc_padrao, "confianca": 50})
        return BuscarResponse(
            disciplinas=disciplinas_web,
            fonte="web",
            total=len(disciplinas_web),
            padrao_detectado=padrao_nome,
        )

    if padrao:
        # Padrão específico identificado → usa como base + enriquece com web
        disciplinas_fallback = [{"nome": d, "confianca": 70} for d in padrao]
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

    # Sem padrão e web insuficiente → retorna o que tem (pode ser vazio)
    # NUNCA inventar disciplinas de uma área que não sabemos qual é
    return BuscarResponse(
        disciplinas=disciplinas_web,
        fonte="web_parcial" if disciplinas_web else "sem_resultados",
        total=len(disciplinas_web),
        padrao_detectado=None,
    )

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


# ═══════════════════════════════════════════════════════════════════════════
# ─── EDITAL EXTRACTOR ───────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

from fastapi import UploadFile, File as FastAPIFile
import tempfile
import os

@app.post("/text")
async def extract_text(file: UploadFile = FastAPIFile(...)):
    """Retorna o texto bruto extraído do PDF — usado para flashcards."""
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        text = ""
        try:
            import pdfplumber
            with pdfplumber.open(tmp_path) as pdf:
                for page in pdf.pages[:100]:
                    extracted = page.extract_text()
                    if extracted:
                        text += extracted + "\n"
        except ImportError:
            pass

        if not text:
            try:
                import fitz
                doc = fitz.open(tmp_path)
                for page in doc:
                    text += page.get_text() + "\n"
                doc.close()
            except ImportError:
                pass

        print(f"[/text] {file.filename} | {len(content)} bytes | {len(text)} chars extraídos")
        if text:
            print(f"[/text] Primeiros 300 chars:\n{text[:300]}")

        return {"text": text, "chars": len(text)}
    finally:
        os.unlink(tmp_path)


@app.post("/extract-questions")
async def extract_questions(file: UploadFile = FastAPIFile(...)):
    """
    Extrai questões de um PDF de provas/simulados.

    Detecta 3 formatos:
      A) Questões + GABARITO simples no final (só letras)
      B) Questões + GABARITO COMENTADO como seção separada
      C) Comentário inline após cada questão

    Retorna lista de questões com enunciado, alternativas, resposta e explicação.
    """
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # ── Extrai texto ───────────────────────────────────────────────────
        text = ""
        try:
            import pdfplumber
            with pdfplumber.open(tmp_path) as pdf:
                for page in pdf.pages[:200]:
                    t = page.extract_text()
                    if t:
                        text += t + "\n"
        except ImportError:
            try:
                import fitz
                doc = fitz.open(tmp_path)
                for page in doc:
                    text += page.get_text() + "\n"
                doc.close()
            except ImportError:
                pass

        if not text.strip():
            return {"questions": [], "format": "unknown", "error": "Não foi possível extrair texto do PDF."}

        print(f"[/extract-questions] {file.filename} | {len(text)} chars")

        # ── Detecta formato ────────────────────────────────────────────────
        fmt = detect_question_format(text)
        print(f"[/extract-questions] Formato detectado: {fmt}")

        # ── Extrai questões ────────────────────────────────────────────────
        questions = extract_questions_from_text(text, fmt)
        print(f"[/extract-questions] {len(questions)} questões extraídas")

        return {"questions": questions, "format": fmt, "total": len(questions)}
    finally:
        os.unlink(tmp_path)


def detect_question_format(text: str) -> str:
    """
    Detecta o formato do PDF de questões:
      'inline'    — resposta/comentário logo após cada questão
      'commented' — seção GABARITO COMENTADO separada
      'simple'    — gabarito de letras no final (mais comum em concursos)
    """
    text_lower = text.lower()
    # Gabarito comentado como seção separada
    if re.search(r'gabarito\s+comentado', text_lower):
        return 'commented'
    # Comentário/resolução inline (pelo menos 3 ocorrências)
    inline_count = len(re.findall(
        r'\n\s*(?:resposta\s*(?:certa|correta)?|comentário|resolução)\s*[:\-–]', text_lower
    ))
    if inline_count >= 3:
        return 'inline'
    # Gabarito simples — palavra "gabarito" na segunda metade do texto
    tail = text_lower[len(text_lower) // 2:]
    if re.search(r'\bgabarito\b', tail):
        return 'simple'
    # Fallback: se há qualquer gabarito no texto
    if re.search(r'\bgabarito\b', text_lower):
        return 'simple'
    return 'simple'


def clean_text_for_extraction(text: str) -> str:
    """Limpa artefatos comuns de PDF antes de extrair questões."""
    # Normaliza quebras de linha
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    # Remove hífens de quebra de palavra
    text = re.sub(r'-\n([a-záéíóúãõàêôûç])', r'\1', text, flags=re.IGNORECASE)
    # Colapsa espaços múltiplos em cada linha
    text = re.sub(r'[^\S\n]+', ' ', text)
    # Remove linhas que são só números de página ou cabeçalhos curtos (<4 chars)
    text = re.sub(r'^\s{0,3}\d{1,3}\s*$', '', text, flags=re.MULTILINE)
    return text


def extract_questions_from_text(text: str, fmt: str) -> list:
    """Extrai questões baseado no formato detectado."""
    text = clean_text_for_extraction(text)

    # ── Separa bloco de questões do gabarito ──────────────────────────────
    questions_block = text
    gabarito_block = ""
    gabarito_comentado_block = ""

    # Gabarito comentado — detecta "GABARITO COMENTADO" em qualquer posição
    m = re.search(r'\n\s*GABARITO\s+COMENTADO\b', text, re.IGNORECASE)
    if m:
        questions_block = text[:m.start()]
        gabarito_comentado_block = text[m.end():]
        fmt = 'commented'
    else:
        # Gabarito simples — aceita "GABARITO", "GABARITO DA PROVA", "GABARITO OFICIAL", etc.
        # Exige que apareça depois de 30% do texto para evitar falso positivo
        m = re.search(r'\n\s*GABARITO\b[^\n]*\n', text, re.IGNORECASE)
        if m and m.start() > len(text) * 0.30:
            questions_block = text[:m.start()]
            gabarito_block = text[m.end():]
            if fmt != 'inline':
                fmt = 'simple'

    print(f"[extract] bloco questões: {len(questions_block)} chars | gabarito: {len(gabarito_block)} | comentado: {len(gabarito_comentado_block)}")

    # ── Divide em blocos de questão ───────────────────────────────────────
    raw_questions = split_into_questions(questions_block)
    print(f"[extract] blocos brutos: {len(raw_questions)}")
    if raw_questions:
        print(f"[extract] primeiro bloco (300 chars): {raw_questions[0][1][:300]}")

    questions = []
    for num, q_text in raw_questions:
        q = parse_single_question(num, q_text, fmt)
        if q:
            questions.append(q)

    print(f"[extract] questões parseadas: {len(questions)} | sem alternativas descartadas: {len(raw_questions)-len(questions)}")

    # ── Associa gabarito simples ──────────────────────────────────────────
    if gabarito_block:
        answers = parse_simple_gabarito(gabarito_block)
        print(f"[extract] gabarito simples: {len(answers)} respostas → {dict(list(answers.items())[:5])}")
        for q in questions:
            if answers.get(q['number']):
                q['answer'] = answers[q['number']]

    # ── Associa gabarito comentado ────────────────────────────────────────
    if gabarito_comentado_block:
        commented = parse_commented_gabarito(gabarito_comentado_block)
        print(f"[extract] gabarito comentado: {len(commented)} entradas")
        for q in questions:
            if q['number'] in commented:
                q['answer'] = commented[q['number']].get('answer', q.get('answer', ''))
                q['explanation'] = commented[q['number']].get('explanation', '')

    return questions


def split_into_questions(text: str) -> list:
    """
    Divide o texto em blocos por número de questão.
    Cobre: "1." "1)" "01." "01)" "Questão 1" "QUESTÃO 01" "1 -" "1 –"
    O número deve aparecer no início da linha (com até 4 espaços de indent).
    """
    pattern = re.compile(
        r'(?:^|\n) {0,4}'                        # início de linha, até 4 espaços
        r'(?:quest[aã]o\s*n?[oº°]?\s*)?'         # "Questão" / "Questão nº" opcional
        r'(0?[1-9]\d{0,2})'                       # número: 1-999, com zero à esquerda opcional
        r'\s*[.):\-–]\s',                          # separador: ) . : - –
        re.IGNORECASE | re.MULTILINE
    )

    matches = list(pattern.finditer(text))
    if not matches:
        return []

    # Filtra sequências que parecem ser alternativas (A, B, C, D, E soltos)
    # e garante que os números são consecutivos (evita pegar anos como "2024.")
    valid = []
    last_num = 0
    for m in matches:
        num = int(m.group(1))
        # Aceita se for consecutivo ou próximo (±5) do último — evita pegar datas
        if num == 1 or (0 < num - last_num <= 5) or (last_num == 0 and num <= 10):
            valid.append((num, m))
            last_num = num

    if not valid:
        # Fallback: aceita todos sem filtro de consecutividade
        valid = [(int(m.group(1)), m) for m in matches]

    blocks = []
    for i, (num, m) in enumerate(valid):
        start = m.end()
        end = valid[i + 1][1].start() if i + 1 < len(valid) else len(text)
        block_text = text[start:end].strip()
        if len(block_text) > 15:
            blocks.append((num, block_text))

    return blocks


def parse_single_question(num: int, text: str, fmt: str) -> dict | None:
    """Parseia uma questão individual extraindo enunciado, alternativas e resposta inline."""

    # ── Detecta alternativas ──────────────────────────────────────────────
    # Cobre: "A)" "(A)" "A." "A -" "a)" — sempre no início da linha
    alt_pattern = re.compile(
        r'(?:^|\n) {0,6}'           # início de linha
        r'\(?([A-Ea-e])\)?'         # letra: A, (A), a
        r'[\s.):\-–]{1,3}'          # separador
        r'(.+?)'                    # conteúdo da alternativa
        r'(?='                      # lookahead: próxima alternativa ou fim
        r'\n {0,6}\(?[A-Ea-e]\)?[\s.):\-–]'
        r'|\n\n|\Z)',
        re.DOTALL
    )

    alt_matches = list(alt_pattern.finditer(text))

    if len(alt_matches) < 2:
        return None  # não tem alternativas suficientes

    options = {}

    # Enunciado = tudo antes da primeira alternativa
    statement_end = alt_matches[0].start()
    statement = text[:statement_end].strip()
    statement = re.sub(r'^[\d.)\s]+', '', statement).strip()

    if len(statement) < 10:
        return None

    # Captura alternativas
    for m in alt_matches:
        letter = m.group(1).upper()
        content = m.group(2).strip()
        # Remove texto de resposta inline que pode ter entrado na alternativa
        content = re.split(r'\n\s*(?:resposta|comentário|resolução|gabarito)\s*[:\-–]', content, flags=re.IGNORECASE)[0].strip()
        if letter in 'ABCDE':
            options[letter] = content

    # ── Tenta capturar resposta e explicação após as alternativas ────────
    answer = ''
    explanation = ''
    after_options = text[alt_matches[-1].end():].strip()

    # Resposta inline: "Resposta: C" / "Gabarito: C" / "Resposta Certa: C"
    ans_m = re.search(
        r'(?:resposta\s*(?:certa|correta)?|gabarito)\s*[:\-–]?\s*\(?([A-Ea-e])\)?',
        after_options, re.IGNORECASE
    )
    if ans_m:
        answer = ans_m.group(1).upper()

    # Explicação inline
    exp_m = re.search(
        r'(?:comentário|resolução|explicação|justificativa)\s*[:\-–]\s*(.+?)(?=\n\n|\Z)',
        after_options, re.IGNORECASE | re.DOTALL
    )
    if exp_m:
        explanation = exp_m.group(1).strip()[:800]
    elif answer and after_options and len(after_options) > 30:
        # Tudo depois da resposta pode ser a explicação
        rest = after_options[ans_m.end():].strip() if ans_m else ''
        if len(rest) > 20:
            explanation = rest[:800]

    return {
        'number': num,
        'statement': statement[:1000],
        'options': options,
        'answer': answer,
        'explanation': explanation,
    }


def parse_simple_gabarito(text: str) -> dict:
    """
    Parseia gabarito simples. Formatos aceitos:
      "1-C  2-A  3-D"
      "1 – C  2 – A"        (en dash / em dash)
      "1. C   2. A"
      "01 C   02 A"          (só espaço)
      "1C 2A 3B"             (colado)
      tabela "| 1 | C |"
      tabela alinhada:
          01  02  03  04  05
          C   A   B   D   E
    """
    answers = {}

    # ── Formato tabela alinhada: linha de números seguida de linha de letras ──
    # Exemplo:
    #   01  02  03  04  05
    #   C   A   B   D   E
    lines = text.split('\n')
    for i in range(len(lines) - 1):
        nums_line = lines[i].strip()
        lets_line = lines[i + 1].strip()
        nums = re.findall(r'\b(0?[1-9]\d{0,2})\b', nums_line)
        lets = re.findall(r'\b([A-Ea-e])\b', lets_line)
        # Deve haver números e o número de letras bate com os números
        # e a linha de letras NÃO deve ter muitos números misturados
        if nums and lets and len(nums) == len(lets) and len(nums) >= 3:
            extra_nums = re.findall(r'\b\d+\b', lets_line)
            if len(extra_nums) == 0:
                for n, l in zip(nums, lets):
                    answers[int(n)] = l.upper()

    if answers:
        return answers

    # ── Formato com separador: "1-C", "1.C", "1) C", "01 – C", "01 — C" ──
    sep = r'[\s\-–—.):(]+'   # qualquer combinação de espaços e separadores comuns
    for m in re.finditer(r'\b(0?[1-9]\d{0,2})' + sep + r'([A-Ea-e])\b', text):
        num = int(m.group(1))
        # Evita capturar anos (ex: "2024 A" em contexto errado)
        if 1 <= num <= 200:
            answers[num] = m.group(2).upper()

    # ── Formato colado "1C 2A 3B" ──
    if not answers:
        for m in re.finditer(r'\b(0?[1-9]\d{0,2})([A-Ea-e])\b', text):
            num = int(m.group(1))
            if 1 <= num <= 200:
                answers[num] = m.group(2).upper()

    return answers


def parse_commented_gabarito(text: str) -> dict:
    """
    Parseia gabarito comentado.
    Formato: "1. Resposta: C\nComentário: ..."
    ou "1. (C) A alternativa C está correta..."
    """
    result = {}
    # Divide por número de questão
    blocks = re.split(r'\n\s*(\d{1,3})\s*[.)]\s*', text)

    i = 1
    while i + 1 < len(blocks):
        try:
            num = int(blocks[i])
            content = blocks[i + 1]

            answer = ''
            explanation = ''

            # Tenta achar a resposta
            ans_m = re.search(r'(?:resposta|gabarito)\s*[:\-–]?\s*\(?([A-Ea-e])\)?', content, re.IGNORECASE)
            if ans_m:
                answer = ans_m.group(1).upper()
            else:
                # Formato: "(C) A alternativa..."
                alt_m = re.match(r'\s*\(?([A-Ea-e])\)?\s', content)
                if alt_m:
                    answer = alt_m.group(1).upper()

            # Tudo o que sobra é a explicação
            explanation = re.sub(
                r'^.*?(?:resposta|gabarito)\s*[:\-–]?\s*[A-Ea-e]\)?\.?\s*',
                '', content, flags=re.IGNORECASE
            ).strip()[:800]

            if answer:
                result[num] = {'answer': answer, 'explanation': explanation}
        except (ValueError, IndexError):
            pass
        i += 2

    return result


@app.post("/extract")
async def extract_edital(file: UploadFile = FastAPIFile(...)):
    """
    Extrai disciplinas e tópicos de um edital PDF.

    Algoritmo:
    1. Lê o PDF com pdfplumber (melhor para layout) ou fallback PyMuPDF
    2. Procura seção "CONTEÚDO PROGRAMÁTICO" ou similar
    3. Aplica NLP/regex para extrair disciplinas e tópicos
    4. Infere pesos baseado em número de tópicos + frequência
    5. Retorna estrutura validável pelo usuário
    """
    # Salva temporariamente
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        text = ""
        method_used = "none"

        # Tenta pdfplumber primeiro
        try:
            import pdfplumber
            with pdfplumber.open(tmp_path) as pdf:
                for page in pdf.pages[:50]:  # máximo 50 páginas
                    extracted = page.extract_text()
                    if extracted:
                        text += extracted + "\n"
            if text:
                method_used = "pdfplumber"
        except ImportError:
            print("[/extract] pdfplumber não instalado, tentando PyMuPDF...")

        # Fallback: PyMuPDF
        if not text:
            try:
                import fitz
                doc = fitz.open(tmp_path)
                for page in doc:
                    text += page.get_text() + "\n"
                doc.close()
                if text:
                    method_used = "pymupdf"
            except ImportError:
                print("[/extract] PyMuPDF não instalado.")

        print(f"[/extract] Arquivo recebido: {file.filename} | Tamanho do buffer: {len(content)} bytes | Extrator: {method_used} | Chars extraídos: {len(text)}")

        if not text:
            print("[/extract] ERRO: nenhum texto extraído do PDF. Instale pdfplumber ou PyMuPDF.")
            return {"subjects": [], "method": "no_extractor", "warning": "Instale pdfplumber ou PyMuPDF para extração."}

        print(f"[/extract] Primeiros 500 chars do texto:\n{text[:500]}")
        print(f"[/extract] ---")

        subjects = extract_subjects_from_text(text)
        print(f"[/extract] Disciplinas encontradas ({len(subjects)}): {[s['name'] for s in subjects]}")

        return {
            "subjects": subjects,
            "method": f"pdf_extraction_{method_used}",
            "totalPages": len(text.split('\n')),
        }
    finally:
        os.unlink(tmp_path)


def extract_subjects_from_text(text: str) -> list[dict]:
    """
    Extrai disciplinas em dois passos:
    PASSO 1 — Extrai nomes das disciplinas da tabela (DA PROVA OBJETIVA)
              ou do MÓDULO I/II dentro do CONTEÚDO PROGRAMÁTICO
    PASSO 2 — Para cada disciplina encontrada, procura a seção dela
              no texto (ex: 'LÍNGUA PORTUGUESA\n tópico1, tópico2...')
              e extrai os tópicos separados por vírgulas ou por linha
    """
    text_norm_full = normalizar(text)

    # ════════════════════════════════════════════════════════════════
    # PASSO 1: coletar nomes das disciplinas + peso (nº de questões)
    # ════════════════════════════════════════════════════════════════
    discipline_list = []  # lista de {'name': str, 'weight': float}

    def is_noise(s):
        s = s.strip()
        return (
            len(s) < 4 or len(s) > 100 or
            re.match(r'^(m[oó]dulo|anexo|total|conhecimentos?\s+(b[aá]sicos?|espec[ií]ficos?)|'
                     r'n[uú]mero|quest[oõ]es|disciplinas?|mat[eé]rias?)', s, re.IGNORECASE) or
            re.search(r'\d{4}', s)  # anos (ex: "2024")
        )

    # ── 1a. Tabela "DISCIPLINAS  Número de Questões" ─────────────────
    tabela_match = re.search(
        r'(?:DISCIPLINAS?|Mat[eé]rias?)\s+N[uú]mero\s+de\s+Quest[oõ]es(.*?)(?=TOTAL\b|\Z)',
        text, re.IGNORECASE | re.DOTALL
    )
    if tabela_match:
        for linha in tabela_match.group(1).split('\n'):
            linha = linha.strip()
            if not linha:
                continue
            m = re.match(r'^(.+?)\s+(\d{1,3})\s*$', linha)
            if m:
                nome, qtd = m.group(1).strip(), int(m.group(2))
                weight = round(max(1.0, qtd / 10), 1)
                # Disciplinas compostas: "Direito Penal / Processual Penal" → duas entradas
                for parte in [p.strip() for p in nome.split('/')]:
                    if not is_noise(parte):
                        discipline_list.append({'name': parte, 'weight': weight})
            else:
                if not is_noise(linha):
                    discipline_list.append({'name': linha, 'weight': 1.0})

    # ── 1b. MÓDULO I / MÓDULO II dentro do CONTEÚDO PROGRAMÁTICO ────
    # Pega o bloco do conteúdo programático
    cp_match = re.search(
        r'(?:ANEXO\s+[IVXLC\d]+[^\n]*)?\s*CONTE[ÚU]DO\s+PROGRAM[ÁA]TICO(.*)',
        text, re.IGNORECASE | re.DOTALL
    )
    bloco_cp = cp_match.group(1) if cp_match else ''
    if not bloco_cp:
        mod_m = re.search(r'M[ÓO]DULO\s+[IVXLC\d]', text, re.IGNORECASE)
        if mod_m:
            bloco_cp = text[mod_m.start():]

    if bloco_cp and not discipline_list:
        # Dentro do bloco, cada linha em MAIÚSCULAS isolada é nome de disciplina
        current_weight = 1.0
        for linha in bloco_cp.split('\n'):
            linha = linha.strip()
            if not linha:
                continue
            # Ajusta peso pelo módulo
            if re.match(r'^M[ÓO]DULO\s+[IVXLC\d]+', linha, re.IGNORECASE):
                current_weight = 1.5 if 'espec' in normalizar(linha) else 1.0
                continue
            # Linha toda maiúscula, sem números = nome de disciplina
            if (linha == linha.upper() and
                    re.match(r'^[A-ZÁÉÍÓÚÃÕÀÊÔÛÇÃ\s/]{4,70}$', linha) and
                    not is_noise(linha)):
                discipline_list.append({'name': linha.title(), 'weight': current_weight})

    # ── 1c. Fallback pelo DISCIPLINAS_DB ────────────────────────────
    if not discipline_list:
        for disciplina, variacoes in DISCIPLINAS_DB.items():
            for variacao in variacoes:
                if normalizar(variacao) in text_norm_full:
                    discipline_list.append({'name': disciplina, 'weight': 1.0})
                    break

    # Remove duplicatas mantendo a primeira ocorrência
    seen_keys = set()
    unique_disciplines = []
    for d in discipline_list:
        key = normalizar(d['name'])[:25]
        if key not in seen_keys:
            seen_keys.add(key)
            unique_disciplines.append(d)
    discipline_list = unique_disciplines

    # ════════════════════════════════════════════════════════════════
    # PASSO 2: para cada disciplina, encontrar sua seção no texto
    #          e extrair tópicos (por vírgula ou por linha)
    # ════════════════════════════════════════════════════════════════
    subjects = []

    for disc in discipline_list:
        name = disc['name']
        weight = disc['weight']
        topics = []

        # Busca a seção da disciplina — o nome dela aparece como cabeçalho
        # seguido dos tópicos (separados por vírgula, ponto-e-vírgula ou por linha)
        name_norm = normalizar(name)
        # Usa as primeiras palavras significativas para achar no texto
        search_term = ' '.join(name_norm.split()[:3])  # ex: "lingua portuguesa"
        idx = text_norm_full.find(search_term)

        if idx >= 0:
            # Pega até 1500 chars após o nome da disciplina
            bloco = text[idx: idx + 1500]
            lines = bloco.split('\n')

            # Pula a primeira linha (é o nome da disciplina) e coleta tópicos
            topic_text = ''
            for i, linha in enumerate(lines[1:], 1):
                linha = linha.strip()
                if not linha:
                    continue
                # Para quando achar outro cabeçalho de seção (próxima disciplina ou módulo)
                linha_norm = normalizar(linha)
                is_next_header = (
                    (linha == linha.upper() and len(linha) > 4 and len(linha) < 80 and
                     re.match(r'^[A-ZÁÉÍÓÚÃÕÀÊ\s/]{4,}$', linha)) or
                    re.match(r'^m[oó]dulo\s+[ivxlc\d]', linha_norm) or
                    re.match(r'^anexo\s+', linha_norm) or
                    re.match(r'^\d+\s*\.\s+[A-Z]', linha)  # "9. DA PROVA..."
                )
                if is_next_header and i > 1:
                    break
                topic_text += ' ' + linha

            # Tópicos podem vir separados por vírgula, ponto-e-vírgula ou ponto
            topic_text = topic_text.strip()
            if ',' in topic_text or ';' in topic_text:
                # Separados por vírgula/ponto-e-vírgula
                raw_topics = re.split(r'[,;]', topic_text)
            else:
                # Separados por linha ou ponto final
                raw_topics = re.split(r'\.\s+|\n', topic_text)

            for t in raw_topics:
                t = re.sub(r'^[\d.]+\s+|^[-•–*]\s+', '', t).strip()
                if 3 < len(t) < 150:
                    topics.append(t)

        subjects.append({
            'name': name,
            'weight': weight,
            'topics': topics[:25],
            'confidence': 0.9 if topics else 0.7,
        })

    # Normaliza pesos proporcionalmente ao máximo encontrado
    if subjects:
        max_w = max(s['weight'] for s in subjects)
        if max_w > 3:
            for s in subjects:
                s['weight'] = round(1.0 + (s['weight'] / max_w) * 2.0, 1)

    print(f"[extract_subjects] {len(subjects)} disciplinas: {[s['name'] for s in subjects]}")
    return subjects


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=3003, reload=True)
