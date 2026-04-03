"""
Aprova.AI — Intelligence Engine
Motor de Decisão + Bot de Análise + Bot de Execução unificados.

Responsabilidades:
- Decidir O QUE o usuário deve estudar agora (priorização inteligente)
- Decidir QUANDO revisar (curva do esquecimento adaptativa)
- Detectar procrastinação e sabotagem
- Gerar plano diário com replanejamento intraday
- Analisar padrões de erro e comportamento
- Gerar insights e intervenções automáticas
- Modo Força Bruta e Modo Guerra
- Planejamento Reverso baseado na data da prova

Porta: 3003 (integrado ao search-service)
"""

import math
import random
from datetime import datetime, timedelta, date
from typing import Optional, List, Dict, Any
from enum import Enum
from pydantic import BaseModel
import asyncio


# ═══════════════════════════════════════════════════════════════════════════
# ─── MODELOS DE DADOS ──────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

class StudyMode(str, Enum):
    NORMAL = "NORMAL"
    FORCA_BRUTA = "FORCA_BRUTA"
    MODO_GUERRA = "MODO_GUERRA"
    RETORNO = "RETORNO"
    CANSADO = "CANSADO"

class BehaviorType(str, Enum):
    DISCIPLINADO = "DISCIPLINADO"
    PROCRASTINADOR = "PROCRASTINADOR"
    ANSIOSO = "ANSIOSO"
    INCONSISTENTE = "INCONSISTENTE"
    GUERREIRO = "GUERREIRO"

class InsightType(str, Enum):
    PADRAO_ERRO = "PADRAO_ERRO"
    HORARIO_PRODUTIVO = "HORARIO_PRODUTIVO"
    QUEDA_DESEMPENHO = "QUEDA_DESEMPENHO"
    ALTA_RETENCAO = "ALTA_RETENCAO"
    RISCO_ABANDONO = "RISCO_ABANDONO"
    FRAQUEZA_CRITICA = "FRAQUEZA_CRITICA"
    SUGESTAO_REVISAO = "SUGESTAO_REVISAO"
    PROGRESSO_RAPIDO = "PROGRESSO_RAPIDO"
    EFICIENCIA_HORARIA = "EFICIENCIA_HORARIA"

class InsightSeverity(str, Enum):
    INFO = "INFO"
    AVISO = "AVISO"
    CRITICO = "CRITICO"
    POSITIVO = "POSITIVO"


# ─── Modelos de request/response ──────────────────────────────────────────

class SubjectData(BaseModel):
    id: str
    name: str
    weight: float = 1.0
    accuracy: Optional[float] = None
    pendingTopics: int = 0

class ScheduledTask(BaseModel):
    id: str
    title: str
    type: str
    estimatedMinutes: int = 60
    topic: Optional[str] = None

class PendingError(BaseModel):
    id: str
    subject: str
    errorType: str

class ProfileData(BaseModel):
    behaviorType: Optional[str] = "INCONSISTENTE"
    activeMode: Optional[str] = "NORMAL"
    performanceScore: Optional[float] = 0
    retentionRate: Optional[float] = 0
    consistencyScore: Optional[float] = 0
    forgettingIndex: Optional[float] = 0.5
    peakHours: Optional[List[str]] = []
    weakSubjects: Optional[List[str]] = []
    avgSessionMinutes: Optional[float] = 60
    abandonmentRate: Optional[float] = 0

class TodayDecisionRequest(BaseModel):
    userId: str
    date: str
    profile: Optional[ProfileData] = None
    subjects: List[SubjectData] = []
    scheduledTasks: List[ScheduledTask] = []
    pendingErrors: List[PendingError] = []
    activeMissions: List[Dict] = []

class ReplanRequest(BaseModel):
    currentPlan: List[Dict]
    completedItems: List[str] = []
    reason: Optional[str] = None
    currentTime: str
    profile: Optional[ProfileData] = None

class ProfileAnalysisRequest(BaseModel):
    userId: str
    examDate: Optional[str] = None
    questionLogs: List[Dict] = []
    studyTasks: List[Dict] = []
    focusSessions: List[Dict] = []
    errorEntries: List[Dict] = []
    emotionLogs: List[Dict] = []
    energyLogs: List[Dict] = []
    behaviorEvents: List[Dict] = []

class ReversePlanRequest(BaseModel):
    examDate: str
    today: str
    dailyStudyHours: float = 2.0
    subjects: List[Dict] = []

class EventReactionRequest(BaseModel):
    userId: str
    eventType: str
    context: Dict = {}
    profile: Optional[ProfileData] = None


# ═══════════════════════════════════════════════════════════════════════════
# ─── MOTOR DE DECISÃO ──────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

class DecisionEngine:
    """
    Coração do sistema. Decide O QUE e QUANDO estudar.

    Regras de priorização (em ordem de peso):
    1. Fraqueza crítica (accuracy < 50%) + alta presença na prova → prioridade máxima
    2. Revisões atrasadas pela curva do esquecimento
    3. Erros pendentes no caderno → cadeia de revisão automática
    4. Modo ativo (FORCA_BRUTA, MODO_GUERRA, CANSADO) → altera completamente a seleção
    5. Energia do momento → tipo de tarefa adaptada
    6. Missões ativas → integra critérios das missões
    """

    # ─── Limiares de decisão ────────────────────────────────────────────────
    ACCURACY_CRITICA = 50       # abaixo disso → força bruta imediata
    ACCURACY_FRACA = 65         # abaixo disso → priorizar revisão
    ACCURACY_BOA = 80           # acima disso → pode avançar
    CONSISTENCY_RUIM = 50       # abaixo disso → alerta de abandono
    RETENTION_MINIMA = 60       # abaixo disso → revisão forçada
    MAX_TOPICOS_DIA = 3         # máximo de tópicos novos por dia
    REVISAO_INTERVALO_BASE = 1  # dias base para revisão (Ebbinghaus)
    SESSION_MINIMA_MIN = 25     # sessão mínima em minutos
    MICRO_ACAO_MIN = 10         # micro-ação para usuário resistente

    def generate_today_plan(
        self,
        request: TodayDecisionRequest,
        current_hour: int = None,
    ) -> Dict:
        """
        Gera o plano completo do dia.

        Algoritmo:
        1. Identifica o modo do usuário
        2. Determina disponibilidade de tempo
        3. Prioriza disciplinas e tarefas por score composto
        4. Monta sequência de ações respeitando energia e ritmo
        5. Insere revisões obrigatórias e micro-ações
        6. Adiciona buffer de replanejamento
        """
        if current_hour is None:
            current_hour = datetime.now().hour

        profile = request.profile or ProfileData()
        mode = StudyMode(profile.activeMode or "NORMAL")

        # Detecta horário de pico
        peak_hours = profile.peakHours or []
        is_peak_time = any(
            int(h.split(":")[0]) == current_hour for h in peak_hours
        )

        # Score de cada disciplina
        subject_scores = self._score_subjects(request.subjects, profile, mode)

        # Plano base
        plan_items = []
        item_id = 0

        # ── MODO GUERRA: apenas revisão + simulados ────────────────────────
        if mode == StudyMode.MODO_GUERRA:
            plan_items = self._build_war_mode_plan(request, subject_scores)

        # ── MODO FORÇA BRUTA: foco total na disciplina mais fraca ──────────
        elif mode == StudyMode.FORCA_BRUTA:
            plan_items = self._build_brute_force_plan(request, subject_scores, profile)

        # ── MODO CANSADO: tarefas leves, curta duração ─────────────────────
        elif mode == StudyMode.CANSADO:
            plan_items = self._build_tired_mode_plan(request, subject_scores)

        # ── MODO RETORNO: plano gradual após abandono ──────────────────────
        elif mode == StudyMode.RETORNO:
            plan_items = self._build_return_plan(request, subject_scores)

        # ── MODO NORMAL: plano balanceado por prioridade ───────────────────
        else:
            plan_items = self._build_normal_plan(request, subject_scores, is_peak_time)

        # Insere revisão de erros pendentes (sempre presente)
        if request.pendingErrors and mode != StudyMode.CANSADO:
            error_block = self._build_error_review_block(request.pendingErrors)
            # Insere após a primeira tarefa (não interrompe o início)
            if len(plan_items) > 1:
                plan_items.insert(1, error_block)
            else:
                plan_items.append(error_block)

        # Adiciona micro-ação final (manter consistência mesmo se plano falhar)
        plan_items.append(self._create_micro_action(request.subjects))

        # Numera e adiciona metadados
        for i, item in enumerate(plan_items):
            item["id"] = f"action_{i+1}"
            item["order"] = i + 1
            item["done"] = False

        total_minutes = sum(item.get("estimatedMinutes", 0) for item in plan_items)

        return {
            "plan": plan_items,
            "totalMinutes": total_minutes,
            "mode": mode.value,
            "isPeakTime": is_peak_time,
            "message": self._get_motivational_message(mode, profile),
            "subjectPriority": [
                {"subject": s["name"], "score": round(s["score"], 1)}
                for s in subject_scores[:5]
            ],
        }

    def _score_subjects(
        self,
        subjects: List[SubjectData],
        profile: ProfileData,
        mode: StudyMode,
    ) -> List[Dict]:
        """
        Calcula score de prioridade de cada disciplina.

        Fórmula:
        score = (peso_prova * 30) + (urgencia_fraqueza * 40) + (revisao_necessaria * 20) + (pendencia * 10)

        - peso_prova: peso configurado pelo usuário (disciplinas da prova)
        - urgencia_fraqueza: quanto mais baixa a accuracy, maior a urgência
        - revisao_necessaria: estimativa de esquecimento pelo índice do perfil
        - pendencia: quantidade de tópicos pendentes
        """
        scored = []
        weak_subjects = profile.weakSubjects or []

        for subj in subjects:
            accuracy = subj.accuracy

            # Componente 1: urgência por fraqueza (0-40)
            if accuracy is None:
                urgency = 20  # desconhecido → prioridade média
            elif accuracy < self.ACCURACY_CRITICA:
                urgency = 40  # crítico
            elif accuracy < self.ACCURACY_FRACA:
                urgency = 30  # fraco
            elif accuracy < self.ACCURACY_BOA:
                urgency = 15  # médio
            else:
                urgency = 5   # bom

            # Componente 2: peso da prova (0-30)
            weight_score = min(30, subj.weight * 10)

            # Componente 3: revisão necessária pelo esquecimento (0-20)
            forgetting_score = profile.forgettingIndex * 20 if subj.name in weak_subjects else 0

            # Componente 4: tópicos pendentes (0-10)
            pending_score = min(10, subj.pendingTopics * 2)

            total_score = urgency + weight_score + forgetting_score + pending_score

            # Boost em modo força bruta para a disciplina mais fraca
            if mode == StudyMode.FORCA_BRUTA and subj.name in weak_subjects:
                total_score *= 2

            scored.append({
                "id": subj.id,
                "name": subj.name,
                "accuracy": accuracy,
                "score": total_score,
                "pendingTopics": subj.pendingTopics,
                "weight": subj.weight,
                "isWeak": accuracy is not None and accuracy < self.ACCURACY_FRACA,
                "isCritical": accuracy is not None and accuracy < self.ACCURACY_CRITICA,
            })

        return sorted(scored, key=lambda x: x["score"], reverse=True)

    def _build_normal_plan(
        self,
        request: TodayDecisionRequest,
        subject_scores: List[Dict],
        is_peak_time: bool,
    ) -> List[Dict]:
        """
        Plano balanceado para o dia normal.

        Estrutura recomendada:
        1. Disciplina mais fraca (estudo + exercícios) — horário de pico
        2. Revisão de flashcards — pode ser em horário de baixa energia
        3. Segunda disciplina (progresso) — energia média
        4. Resolução de questões — energia alta ou média
        5. Revisão rápida dos erros do dia
        """
        plan = []

        # Bloco 1: disciplina crítica ou mais fraca (se horário de pico, usa a mais difícil)
        if subject_scores:
            top = subject_scores[0]
            if top["isCritical"]:
                plan.append({
                    "type": "ESTUDO_INTENSIVO",
                    "subject": top["name"],
                    "subjectId": top["id"],
                    "title": f"[CRITICO] Estudo de {top['name']}",
                    "description": f"Taxa de acerto em {top['name']} esta em {round(top['accuracy'] or 0)}%. Foco total nessa disciplina agora.",
                    "estimatedMinutes": 60,
                    "taskType": "EXERCICIOS",
                    "priority": "CRITICA",
                    "tip": "Resolva pelo menos 20 questoes para medir seu avanco real.",
                })
            else:
                plan.append({
                    "type": "ESTUDO",
                    "subject": top["name"],
                    "subjectId": top["id"],
                    "title": f"Estudo: {top['name']}",
                    "description": f"Disciplina prioritaria do dia. {top['pendingTopics']} topicos pendentes.",
                    "estimatedMinutes": 50,
                    "taskType": "LEITURA",
                    "priority": "ALTA",
                })

        # Bloco 2: flashcards (revisão espaçada)
        plan.append({
            "type": "REVISAO_FLASHCARDS",
            "title": "Revisao Espacada: Flashcards",
            "description": "Revise seus flashcards vencidos. A revisao espacada e a tecnica mais eficiente para retencao a longo prazo.",
            "estimatedMinutes": 20,
            "taskType": "FLASHCARDS",
            "priority": "MEDIA",
            "tip": "Avalie honestamente cada cartao. Nao marque como facil se tiver duvida.",
        })

        # Bloco 3: segunda disciplina (progresso)
        if len(subject_scores) > 1:
            second = subject_scores[1]
            plan.append({
                "type": "PROGRESSO",
                "subject": second["name"],
                "subjectId": second["id"],
                "title": f"Avance em {second['name']}",
                "description": f"Mantenha o progresso em {second['name']}.",
                "estimatedMinutes": 40,
                "taskType": "LEITURA",
                "priority": "MEDIA",
            })

        # Bloco 4: questões (prática)
        if subject_scores:
            top = subject_scores[0]
            plan.append({
                "type": "QUESTOES",
                "subject": top["name"],
                "subjectId": top["id"],
                "title": f"Questoes de {top['name']}",
                "description": "Pratique com questoes reais de provas anteriores.",
                "estimatedMinutes": 30,
                "taskType": "EXERCICIOS",
                "priority": "ALTA",
                "minQuestions": 15,
            })

        # Integra tarefas já agendadas (do plano de estudos existente)
        for task in request.scheduledTasks[:2]:
            plan.append({
                "type": "TAREFA_AGENDADA",
                "taskId": task.id,
                "title": task.title,
                "description": f"Tarefa do seu plano de estudos: {task.topic or task.type}",
                "estimatedMinutes": task.estimatedMinutes,
                "taskType": task.type,
                "priority": "NORMAL",
            })

        return plan

    def _build_war_mode_plan(
        self,
        request: TodayDecisionRequest,
        subject_scores: List[Dict],
    ) -> List[Dict]:
        """
        Modo Guerra: reta final da prova.
        Foco em: simulados, revisão intensa, zero tópico novo.

        Estrutura:
        - Simulado com tempo real
        - Revisão dos erros do simulado
        - Revisão das 3 disciplinas mais fracas
        - Flashcards de revisão
        """
        plan = [
            {
                "type": "SIMULADO",
                "title": "SIMULADO DO DIA — Modo Guerra",
                "description": "Simule as condicoes reais da prova. Sem consultar material durante.",
                "estimatedMinutes": 90,
                "taskType": "SIMULADO",
                "priority": "MAXIMA",
                "warMode": True,
                "instructions": [
                    "Sem celular e distractores",
                    "Cronometre o tempo real",
                    "Anote erros para revisao imediata",
                ],
            },
            {
                "type": "REVISAO_SIMULADO",
                "title": "Revisao dos Erros do Simulado",
                "description": "Analise cada erro. Entenda o motivo. Crie flashcard para os mais dificeis.",
                "estimatedMinutes": 30,
                "taskType": "REVISAO",
                "priority": "MAXIMA",
            },
        ]

        # Top 3 disciplinas mais fracas para revisão intensiva
        weak = [s for s in subject_scores if s["isWeak"]][:3]
        for subj in weak:
            plan.append({
                "type": "REVISAO_INTENSA",
                "subject": subj["name"],
                "subjectId": subj["id"],
                "title": f"Revisao Intensa: {subj['name']}",
                "description": f"Revisao focada. Taxa atual: {round(subj['accuracy'] or 0)}%. Meta: 70%+.",
                "estimatedMinutes": 40,
                "taskType": "REVISAO",
                "priority": "ALTA",
                "warMode": True,
            })

        plan.append({
            "type": "REVISAO_FLASHCARDS",
            "title": "Flashcards — Consolidacao Final",
            "description": "Ultima revisao dos cards criticos antes da prova.",
            "estimatedMinutes": 25,
            "taskType": "FLASHCARDS",
            "priority": "ALTA",
        })

        return plan

    def _build_brute_force_plan(
        self,
        request: TodayDecisionRequest,
        subject_scores: List[Dict],
        profile: ProfileData,
    ) -> List[Dict]:
        """
        Modo Força Bruta: foco exclusivo na disciplina mais crítica.
        Bloqueia outras disciplinas temporariamente.

        Estrutura:
        - 3 blocos da disciplina crítica
        - Análise de padrão de erros
        - Questões intensivas
        """
        critical = next(
            (s for s in subject_scores if s["isCritical"]),
            subject_scores[0] if subject_scores else None,
        )

        if not critical:
            return self._build_normal_plan(request, subject_scores, False)

        return [
            {
                "type": "FORCA_BRUTA_1",
                "subject": critical["name"],
                "subjectId": critical["id"],
                "title": f"FORCA BRUTA — Bloco 1: Teoria de {critical['name']}",
                "description": f"Estude os fundamentos mais cobrados de {critical['name']}. Sem pular topicos.",
                "estimatedMinutes": 45,
                "taskType": "LEITURA",
                "priority": "MAXIMA",
                "bruteForce": True,
            },
            {
                "type": "FORCA_BRUTA_2",
                "subject": critical["name"],
                "subjectId": critical["id"],
                "title": f"FORCA BRUTA — Bloco 2: 30 Questoes de {critical['name']}",
                "description": "Resolva 30 questoes sem olhar o gabarito durante. Identifique seus pontos cegos.",
                "estimatedMinutes": 45,
                "taskType": "EXERCICIOS",
                "priority": "MAXIMA",
                "bruteForce": True,
                "minQuestions": 30,
            },
            {
                "type": "FORCA_BRUTA_3",
                "subject": critical["name"],
                "subjectId": critical["id"],
                "title": f"FORCA BRUTA — Bloco 3: Revisao dos Erros de {critical['name']}",
                "description": "Corrija cada erro. Para cada um: releia o conteudo + crie flashcard.",
                "estimatedMinutes": 30,
                "taskType": "REVISAO",
                "priority": "MAXIMA",
                "bruteForce": True,
                "chain": ["FLASHCARD_CREATION", "ERROR_NOTEBOOK"],
            },
        ]

    def _build_tired_mode_plan(
        self,
        request: TodayDecisionRequest,
        subject_scores: List[Dict],
    ) -> List[Dict]:
        """
        Modo Cansado: manter consistência com esforço mínimo.
        Prioriza tarefas passivas e de baixa carga cognitiva.
        """
        lightest = sorted(subject_scores, key=lambda x: x.get("score", 0))[:2]

        plan = [
            {
                "type": "MICRO_REVISAO",
                "title": "Revisao Leve — Flashcards",
                "description": "So os flashcards mais faceis hoje. Mantenha a consistencia sem se forcar.",
                "estimatedMinutes": 15,
                "taskType": "FLASHCARDS",
                "priority": "BAIXA",
                "tiredMode": True,
            },
        ]

        if lightest:
            plan.append({
                "type": "LEITURA_LEVE",
                "subject": lightest[0]["name"],
                "subjectId": lightest[0]["id"],
                "title": f"Leitura Leve: {lightest[0]['name']}",
                "description": "Apenas leitura. Sem resolver questoes. Absorva o conteudo passivamente.",
                "estimatedMinutes": 20,
                "taskType": "LEITURA",
                "priority": "BAIXA",
                "tiredMode": True,
            })

        plan.append({
            "type": "QUESTOES_RAPIDAS",
            "title": "5 Questoes Rapidas",
            "description": "So 5 questoes para manter o ritmo. Voce consegue.",
            "estimatedMinutes": 10,
            "taskType": "EXERCICIOS",
            "priority": "BAIXA",
            "tiredMode": True,
            "minQuestions": 5,
        })

        return plan

    def _build_return_plan(
        self,
        request: TodayDecisionRequest,
        subject_scores: List[Dict],
    ) -> List[Dict]:
        """
        Plano de retorno após período de abandono.
        Começa devagar, foco em reconstruir hábito.
        """
        return [
            {
                "type": "RETORNO",
                "title": "Bem-vindo de Volta! Revisao Geral Rapida",
                "description": "Voce estava ausente. Vamos comecar com calma. Revise o que sabe antes de avancar.",
                "estimatedMinutes": 20,
                "taskType": "REVISAO",
                "priority": "MEDIA",
                "returnMode": True,
                "message": "A consistencia e mais importante que a intensidade. Um dia de cada vez.",
            },
            {
                "type": "FLASHCARDS_RETORNO",
                "title": "Revise seus Flashcards",
                "description": "Muito conteudo pode ter sido esquecido. Os flashcards vao revelar suas lacunas.",
                "estimatedMinutes": 15,
                "taskType": "FLASHCARDS",
                "priority": "MEDIA",
            },
            {
                "type": "QUESTOES_RETORNO",
                "subject": subject_scores[0]["name"] if subject_scores else "Geral",
                "title": "10 Questoes — Aquecimento",
                "description": "So para aquecer. Sem pressao.",
                "estimatedMinutes": 15,
                "taskType": "EXERCICIOS",
                "priority": "BAIXA",
                "minQuestions": 10,
            },
        ]

    def _build_error_review_block(self, pending_errors: List[PendingError]) -> Dict:
        """
        Bloco de revisão de erros pendentes.
        Gera cadeia automática: revisão → flashcard → questão relacionada.
        """
        most_common_subject = {}
        for e in pending_errors:
            most_common_subject[e.subject] = most_common_subject.get(e.subject, 0) + 1
        top_subject = max(most_common_subject, key=most_common_subject.get) if most_common_subject else "Geral"

        return {
            "type": "REVISAO_ERROS",
            "title": f"Caderno de Erros — {len(pending_errors)} pendentes",
            "description": f"Voce tem {len(pending_errors)} erros para revisar. A maior concentracao e em {top_subject}.",
            "estimatedMinutes": min(30, len(pending_errors) * 3),
            "taskType": "REVISAO",
            "priority": "ALTA",
            "errorCount": len(pending_errors),
            "topSubject": top_subject,
            "chain": [
                f"Revisar erro → criar flashcard → resolver 3 questoes similares",
            ],
        }

    def _create_micro_action(self, subjects: List[SubjectData]) -> Dict:
        """
        Micro-ação: tarefa mínima que garante consistência mesmo que o resto do plano falhe.
        Se o usuário fizer APENAS isso, o dia não foi zero.
        """
        subject_name = subjects[0].name if subjects else "qualquer disciplina"
        return {
            "type": "MICRO_ACAO",
            "title": "Micro-Acao do Dia (minimo vital)",
            "description": f"Se voce nao conseguir fazer mais nada hoje, faca pelo menos isso: 10 questoes de {subject_name}. 10 minutos. Consistencia acima de tudo.",
            "estimatedMinutes": 10,
            "taskType": "EXERCICIOS",
            "priority": "MINIMA",
            "isMicroAction": True,
            "minQuestions": 10,
        }

    def _get_motivational_message(self, mode: StudyMode, profile: ProfileData) -> str:
        behavior = profile.behaviorType or "INCONSISTENTE"
        messages = {
            StudyMode.MODO_GUERRA: "MODO GUERRA: Cada minuto conta. A prova esta chegando. Foco maximo.",
            StudyMode.FORCA_BRUTA: "FORCA BRUTA ativada. Nos proximos dias voce vai eliminar essa fraqueza.",
            StudyMode.CANSADO: "Modo cansado: faca o minimo. Consistencia e mais importante que intensidade.",
            StudyMode.RETORNO: "Bem-vindo de volta. Comece devagar. O habito e mais poderoso que a vontade.",
            StudyMode.NORMAL: {
                "DISCIPLINADO": "Continue assim. Disciplina e o seu maior trunfo.",
                "PROCRASTINADOR": "Execute a primeira tarefa agora. Apenas a primeira. O resto vem sozinho.",
                "ANSIOSO": "Um passo de cada vez. Voce nao precisa fazer tudo hoje.",
                "INCONSISTENTE": "Hoje e o dia de quebrar o ciclo. Faca pelo menos a micro-acao.",
                "GUERREIRO": "Voce sabe o que fazer. Va em frente.",
            }.get(behavior, "Foco total. Vamos estudar."),
        }
        result = messages.get(mode, "Foque no plano do dia.")
        if isinstance(result, dict):
            return result.get(behavior, "Foco no plano.")
        return result

    # ─── Replanejamento intraday ──────────────────────────────────────────

    def replan_intraday(self, request: ReplanRequest) -> Dict:
        """
        Replanejar DURANTE o dia quando o usuário está atrasado ou mudou de situação.

        Algoritmo:
        1. Identifica itens não concluídos
        2. Calcula tempo restante do dia
        3. Remove/comprime tarefas baseado no tempo disponível
        4. Prioriza os itens com maior score
        5. Garante que a micro-ação sempre fique
        """
        current_time = request.currentTime  # "14:30"
        hour, minute = map(int, current_time.split(":"))
        minutes_remaining = max(0, (22 * 60) - (hour * 60 + minute))  # até 22h

        pending_items = [
            item for item in request.currentPlan
            if item.get("id") not in request.completedItems and not item.get("done")
        ]

        total_pending_time = sum(item.get("estimatedMinutes", 0) for item in pending_items)

        if total_pending_time <= minutes_remaining:
            # Sem necessidade de replanejar
            return {"plan": request.currentPlan, "replanned": False, "message": "Voce esta no ritmo!"}

        # Precisa comprimir o plano
        deficit = total_pending_time - minutes_remaining
        reason = request.reason or "atraso"

        adapted = []
        micro_action = None

        for item in pending_items:
            if item.get("type") == "MICRO_ACAO":
                micro_action = item
                continue

            # Comprime tarefas longas
            minutes = item.get("estimatedMinutes", 60)
            if deficit > 0 and minutes > 30:
                reduction = min(deficit, minutes - 20)
                item = {**item, "estimatedMinutes": minutes - reduction, "compressed": True}
                deficit -= reduction

            # Remove tarefas de baixa prioridade se ainda precisa tempo
            priority = item.get("priority", "NORMAL")
            if deficit > 0 and priority in ("BAIXA", "MINIMA"):
                item = {**item, "skipped": True, "skipReason": f"Removido no replanejamento: {reason}"}
                deficit -= item.get("estimatedMinutes", 0)

            adapted.append(item)

        # Micro-ação sempre fica
        if micro_action:
            adapted.append(micro_action)

        # Adiciona bloco de recuperação para amanhã
        adapted.append({
            "type": "RECUPERACAO_AMANHA",
            "title": "Lembrete: Tarefas para amanha",
            "description": f"O plano de hoje foi reajustado por: {reason}. As tarefas nao concluidas foram reagendadas.",
            "estimatedMinutes": 0,
            "taskType": "LEITURA",
            "priority": "INFO",
            "done": False,
            "isInfo": True,
        })

        messages = {
            "atraso": f"Plano comprimido. Voce esta {int(total_pending_time - minutes_remaining)} min atrasado.",
            "cansado": "Plano simplificado. Faca o essencial e descanse.",
            "imprevisto": "Imprevisto detectado. Priorizei o que importa mais.",
        }

        return {
            "plan": adapted,
            "replanned": True,
            "message": messages.get(reason, f"Plano ajustado: {reason}"),
            "deficit": int(total_pending_time - minutes_remaining),
        }

    # ─── Planejamento Reverso ─────────────────────────────────────────────

    def generate_reverse_plan(self, request: ReversePlanRequest) -> Dict:
        """
        Planejamento reverso a partir da data da prova.

        Fases:
        1. Dias > 90: estudo amplo, todos os tópicos
        2. Dias 60-90: aprofundamento nas fracas
        3. Dias 30-60: revisão + questões intensivas
        4. Dias 15-30: simulados + revisão de erros
        5. Dias < 15: MODO GUERRA — só revisão e simulados
        """
        exam_dt = datetime.fromisoformat(request.examDate.replace("Z", "+00:00"))
        today_dt = datetime.fromisoformat(request.today.replace("Z", "+00:00"))
        days_left = (exam_dt.date() - today_dt.date()).days

        if days_left <= 0:
            return {"error": "A prova ja passou ou e hoje.", "daysLeft": days_left}

        daily_minutes = request.dailyStudyHours * 60

        # Calcula carga total de tópicos pendentes
        total_pending_hours = sum(
            sum(t.get("estimatedHours", 1) for t in s.get("pendingTopics", []))
            for s in request.subjects
        )
        total_pending_minutes = total_pending_hours * 60
        available_minutes = days_left * daily_minutes

        # Define fase atual
        if days_left > 90:
            phase = "ESTUDO_AMPLO"
            phase_label = "Fase 1 — Estudo Amplo"
            recommendation = "Estude todos os topicos. Foque em construir base solida."
        elif days_left > 60:
            phase = "APROFUNDAMENTO"
            phase_label = "Fase 2 — Aprofundamento"
            recommendation = "Aprofunde as disciplinas mais fracas. Comece questoes regulares."
        elif days_left > 30:
            phase = "REVISAO_QUESTOES"
            phase_label = "Fase 3 — Revisao + Questoes"
            recommendation = "Revisao intensa + 30 questoes por dia. Nenhum topico novo."
        elif days_left > 15:
            phase = "SIMULADOS"
            phase_label = "Fase 4 — Simulados"
            recommendation = "1 simulado por semana. Revisao dos erros. Flashcards diarios."
        else:
            phase = "MODO_GUERRA"
            phase_label = "MODO GUERRA — Reta Final"
            recommendation = "Apenas revisao e simulados. Acorde cedo. Durma bem."

        # Distribui tópicos por dia
        subjects_plan = []
        days_per_subject = max(1, days_left // max(1, len(request.subjects)))

        current_day = 0
        for subj in sorted(request.subjects, key=lambda x: x.get("accuracy", 50) or 50):
            accuracy = subj.get("accuracy")
            pending = subj.get("pendingTopics", [])

            if not pending:
                continue

            # Disciplinas fracas ganham mais dias
            multiplier = 1.5 if (accuracy and accuracy < 60) else 1.0
            allocated_days = int(days_per_subject * multiplier)

            subjects_plan.append({
                "subject": subj["name"],
                "accuracy": accuracy,
                "pendingTopics": len(pending),
                "startDay": current_day + 1,
                "endDay": current_day + allocated_days,
                "dailyGoal": f"{len(pending) // max(1, allocated_days)} topicos/dia",
                "priority": "ALTA" if (accuracy and accuracy < 60) else "NORMAL",
            })
            current_day += allocated_days

        # Milestones
        milestones = []
        checkpoints = [
            (days_left // 4 * 3, "Revisar todo o conteudo 1x"),
            (days_left // 2, "Taxa de acerto > 60% em todas as disciplinas"),
            (days_left // 4, "Simulados semanais + revisao de erros"),
            (15, "MODO GUERRA: so revisao e simulados"),
            (7, "Relaxar. Revisar apenas pontos criticos."),
            (1, "Descanse. Voce esta pronto."),
        ]
        for days_to_go, label in checkpoints:
            if days_left > days_to_go:
                milestone_date = (today_dt + timedelta(days=days_left - days_to_go)).strftime("%Y-%m-%d")
                milestones.append({"date": milestone_date, "daysLeft": days_to_go, "label": label})

        feasibility = min(100, int((available_minutes / max(1, total_pending_minutes)) * 100))

        return {
            "daysLeft": days_left,
            "examDate": request.examDate,
            "phase": phase,
            "phaseLabel": phase_label,
            "recommendation": recommendation,
            "feasibility": feasibility,
            "feasibilityMessage": (
                "Plano viavel! Voce tem tempo suficiente." if feasibility >= 80
                else "Atencao: o tempo esta apertado. Priorize as disciplinas mais fracas."
                if feasibility >= 50
                else "ALERTA: Tempo insuficiente para todo o conteudo. Foque no que tem mais peso na prova."
            ),
            "dailyStudyHours": request.dailyStudyHours,
            "subjectsPlan": subjects_plan,
            "milestones": milestones,
            "totalPendingHours": round(total_pending_hours, 1),
            "availableHours": round(available_minutes / 60, 1),
            "warModeStart": (today_dt + timedelta(days=max(0, days_left - 60))).strftime("%Y-%m-%d"),
        }


# ═══════════════════════════════════════════════════════════════════════════
# ─── BOT DE ANÁLISE ────────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

class AnalysisBot:
    """
    Analisa comportamento do usuário e gera insights acionáveis.

    Roda: sob demanda ou agendado (via endpoint /analyze/profile)

    Detecta:
    - Padrões de erro recorrentes
    - Horários produtivos reais
    - Curva de esquecimento personalizada
    - Risco de abandono
    - Sabotagem comportamental
    """

    def analyze_profile(self, request: ProfileAnalysisRequest) -> Dict:
        """Análise completa do perfil do usuário."""

        profile_updates = {}
        insights = []

        # ── 1. Análise de desempenho por disciplina ────────────────────────
        subject_performance = self._analyze_subject_performance(request.questionLogs)
        weak_subjects = [s for s, d in subject_performance.items() if d["accuracy"] < 60]
        strong_subjects = [s for s, d in subject_performance.items() if d["accuracy"] >= 80]

        profile_updates["weakSubjects"] = weak_subjects
        profile_updates["strongSubjects"] = strong_subjects

        if weak_subjects:
            worst = min(subject_performance.items(), key=lambda x: x[1]["accuracy"])
            if worst[1]["accuracy"] < 50:
                insights.append({
                    "type": "FRAQUEZA_CRITICA",
                    "title": f"Fraqueza Critica: {worst[0]}",
                    "body": f"Sua taxa de acerto em {worst[0]} e de apenas {round(worst[1]['accuracy'])}%. "
                            f"Isso representa risco real para a sua aprovacao. "
                            f"Ative o Modo Forca Bruta para focar exclusivamente nessa disciplina.",
                    "severity": "CRITICO",
                    "action": "ATIVAR_FORCA_BRUTA",
                    "data": {"subject": worst[0], "accuracy": round(worst[1]["accuracy"])},
                })

        # ── 2. Análise de consistência ─────────────────────────────────────
        consistency = self._analyze_consistency(request.studyTasks)
        profile_updates["consistencyScore"] = consistency["score"]

        if consistency["score"] < 50:
            insights.append({
                "type": "RISCO_ABANDONO",
                "title": "Consistencia em queda",
                "body": f"Voce estudou em apenas {consistency['studiedDays']} dos ultimos {consistency['totalDays']} dias. "
                        f"Consistencia e o fator mais critico para aprovacao. "
                        f"Ative o plano de retorno gradual.",
                "severity": "AVISO",
                "action": "ATIVAR_RETORNO",
                "data": consistency,
            })

        # ── 3. Análise de energia e horários produtivos ────────────────────
        energy_analysis = self._analyze_energy_patterns(request.energyLogs, request.questionLogs)
        profile_updates["peakHours"] = energy_analysis["peakHours"]

        if energy_analysis["peakHours"]:
            insights.append({
                "type": "HORARIO_PRODUTIVO",
                "title": "Seus horarios de pico identificados",
                "body": f"Voce performa melhor entre {', '.join(energy_analysis['peakHours'])}. "
                        f"Agende suas tarefas mais dificeis nesses horarios.",
                "severity": "POSITIVO",
                "data": energy_analysis,
            })

        # ── 4. Taxa de retenção (flashcards) ──────────────────────────────
        retention = self._analyze_retention(request.behaviorEvents)
        profile_updates["retentionRate"] = retention

        if retention < 60:
            insights.append({
                "type": "SUGESTAO_REVISAO",
                "title": "Taxa de retencao baixa",
                "body": f"Sua taxa de retencao e de {retention}%. Aumente a frequencia de revisao dos flashcards. "
                        f"Estude mais vezes, por periodos mais curtos.",
                "severity": "AVISO",
                "data": {"retentionRate": retention},
            })

        # ── 5. Detecção de procrastinação ──────────────────────────────────
        procrastination = self._detect_procrastination_pattern(request.behaviorEvents)
        behavior_type = self._classify_behavior(consistency, procrastination, subject_performance)
        profile_updates["behaviorType"] = behavior_type

        if procrastination["score"] > 60:
            insights.append({
                "type": "PADRAO_ERRO",
                "title": f"Padrao de procrastinacao detectado: {procrastination['mainType']}",
                "body": procrastination["message"],
                "severity": "AVISO",
                "data": procrastination,
            })

        # ── 6. Análise de padrão de erros ──────────────────────────────────
        error_patterns = self._analyze_error_patterns(request.errorEntries)
        if error_patterns["topErrorType"]:
            insights.append({
                "type": "PADRAO_ERRO",
                "title": f"Padrao de erros: {error_patterns['topErrorType']}",
                "body": error_patterns["message"],
                "severity": "INFO",
                "data": error_patterns,
            })

        # ── 7. Score geral de desempenho ───────────────────────────────────
        all_q = request.questionLogs
        total = len(all_q)
        correct = sum(1 for q in all_q if q.get("isCorrect"))
        accuracy = (correct / total * 100) if total > 0 else 0
        profile_updates["performanceScore"] = round(accuracy, 1)

        # ── 8. Sessão média ────────────────────────────────────────────────
        if request.focusSessions:
            avg_session = sum(f.get("totalMinutes", 0) for f in request.focusSessions) / len(request.focusSessions)
            profile_updates["avgSessionMinutes"] = round(avg_session, 1)

        # ── 9. Taxa de abandono ────────────────────────────────────────────
        completed_tasks = sum(1 for t in request.studyTasks if t.get("isCompleted"))
        total_tasks = len(request.studyTasks)
        abandonment = round((1 - completed_tasks / max(1, total_tasks)) * 100, 1)
        profile_updates["abandonmentRate"] = abandonment

        if abandonment > 50:
            insights.append({
                "type": "RISCO_ABANDONO",
                "title": "Alto indice de tarefas nao concluidas",
                "body": f"Voce abandona {abandonment}% das tarefas iniciadas. "
                        f"Considere reduzir a carga diaria e usar o modo Cansado quando necessario.",
                "severity": "AVISO",
                "data": {"abandonmentRate": abandonment},
            })

        return {"profile": profile_updates, "insights": insights}

    def _analyze_subject_performance(self, question_logs: List[Dict]) -> Dict:
        by_subject = {}
        for q in question_logs:
            subject = q.get("subject", "Desconhecido")
            if subject not in by_subject:
                by_subject[subject] = {"total": 0, "correct": 0}
            by_subject[subject]["total"] += 1
            if q.get("isCorrect"):
                by_subject[subject]["correct"] += 1

        return {
            s: {
                "accuracy": round(d["correct"] / d["total"] * 100, 1),
                "total": d["total"],
                "correct": d["correct"],
            }
            for s, d in by_subject.items()
            if d["total"] >= 3  # mínimo para análise significativa
        }

    def _analyze_consistency(self, study_tasks: List[Dict]) -> Dict:
        completed_dates = set()
        for t in study_tasks:
            if t.get("isCompleted") and t.get("completedAt"):
                try:
                    dt = datetime.fromisoformat(str(t["completedAt"]).replace("Z", "+00:00"))
                    completed_dates.add(dt.strftime("%Y-%m-%d"))
                except Exception:
                    pass

        # Últimos 30 dias
        total_days = 30
        studied_days = len([d for d in completed_dates if d >= (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")])
        score = round(studied_days / total_days * 100, 1)

        return {
            "score": score,
            "studiedDays": studied_days,
            "totalDays": total_days,
            "percentage": f"{round(studied_days / total_days * 100)}%",
        }

    def _analyze_energy_patterns(self, energy_logs: List[Dict], question_logs: List[Dict]) -> Dict:
        by_hour = {}
        for log in energy_logs:
            h = log.get("hour")
            if h is None:
                continue
            if h not in by_hour:
                by_hour[h] = {"energy": [], "performance": []}
            by_hour[h]["energy"].append(log.get("level", 3))
            if log.get("performance") is not None:
                by_hour[h]["performance"].append(log["performance"])

        # Complementa com performance de questões por hora
        for q in question_logs:
            try:
                logged_at = q.get("loggedAt") or q.get("created_at")
                if logged_at:
                    dt = datetime.fromisoformat(str(logged_at).replace("Z", "+00:00"))
                    h = dt.hour
                    if h not in by_hour:
                        by_hour[h] = {"energy": [], "performance": []}
                    by_hour[h]["performance"].append(100 if q.get("isCorrect") else 0)
            except Exception:
                pass

        peak_hours = []
        for h, data in by_hour.items():
            avg_energy = sum(data["energy"]) / len(data["energy"]) if data["energy"] else 0
            avg_perf = sum(data["performance"]) / len(data["performance"]) if data["performance"] else 0
            combined = avg_energy * 10 + avg_perf * 0.3
            if combined >= 45:  # threshold de pico
                peak_hours.append(f"{str(h).zfill(2)}:00")

        return {
            "peakHours": sorted(peak_hours),
            "byHour": {
                str(h): {
                    "avgEnergy": round(sum(d["energy"]) / len(d["energy"]), 1) if d["energy"] else None,
                    "avgPerformance": round(sum(d["performance"]) / len(d["performance"]), 1) if d["performance"] else None,
                }
                for h, d in by_hour.items()
            },
        }

    def _analyze_retention(self, behavior_events: List[Dict]) -> float:
        flashcard_events = [e for e in behavior_events if e.get("type") == "FLASHCARD_REVISADO"]
        if not flashcard_events:
            return 50.0  # valor padrão se sem dados

        good = sum(1 for e in flashcard_events if e.get("metadata", {}).get("rating", 0) >= 2)
        return round(good / len(flashcard_events) * 100, 1)

    def _detect_procrastination_pattern(self, behavior_events: List[Dict]) -> Dict:
        skipped = sum(1 for e in behavior_events if e.get("type") == "TAREFA_PULADA")
        abandoned = sum(1 for e in behavior_events if e.get("type") == "TAREFA_ABANDONADA")
        inactivity = sum(1 for e in behavior_events if e.get("type") == "INATIVIDADE_DETECTADA")
        total = max(1, len(behavior_events))

        score = min(100, (skipped * 3 + abandoned * 5 + inactivity * 2) / total * 100)

        if score > 70:
            main_type = "SABOTAGEM"
            message = ("Voce esta consistentemente evitando suas tarefas. "
                      "O sistema vai aumentar a pressao e reduzir a complexidade para quebrar esse ciclo.")
        elif score > 40:
            main_type = "PROCRASTINACAO"
            message = ("Padrao de procrastinacao detectado. "
                      "Tente a tecnica dos 2 minutos: comece qualquer tarefa por apenas 2 minutos.")
        else:
            main_type = "NORMAL"
            message = "Comportamento normal. Continue assim."

        return {
            "score": round(score, 1),
            "mainType": main_type,
            "message": message,
            "skippedTasks": skipped,
            "abandonedTasks": abandoned,
            "inactivityEvents": inactivity,
        }

    def _analyze_error_patterns(self, error_entries: List[Dict]) -> Dict:
        by_type = {}
        for e in error_entries:
            t = e.get("errorType", "DESCONHECIDO")
            by_type[t] = by_type.get(t, 0) + 1

        if not by_type:
            return {"topErrorType": None, "message": "Sem erros suficientes para analise."}

        top = max(by_type, key=by_type.get)
        messages = {
            "FALTA_ATENCAO": (
                "Seus erros sao principalmente por falta de atencao. "
                "Leia as questoes com mais calma. Sublinhe palavras-chave."
            ),
            "CONTEUDO_NAO_ESTUDADO": (
                "Voce esta errando por conteudo que ainda nao estudou. "
                "Revise os topicos basicos antes de resolver questoes."
            ),
            "INTERPRETACAO": (
                "Dificuldade de interpretacao detectada. "
                "Pratique leitura de textos juridicos e legislacao diariamente."
            ),
            "ESQUECIMENTO": (
                "Voce sabe o conteudo mas esquece na hora da prova. "
                "Aumente a frequencia de revisao espacada via flashcards."
            ),
        }

        return {
            "topErrorType": top,
            "count": by_type[top],
            "message": messages.get(top, f"Padrao de erro mais frequente: {top}"),
            "distribution": by_type,
        }

    def _classify_behavior(self, consistency: Dict, procrastination: Dict, performance: Dict) -> str:
        consistency_score = consistency.get("score", 0)
        proc_score = procrastination.get("score", 0)
        avg_accuracy = (
            sum(d["accuracy"] for d in performance.values()) / len(performance)
            if performance else 0
        )

        if consistency_score >= 80 and avg_accuracy >= 70:
            return "DISCIPLINADO"
        if consistency_score >= 80 and avg_accuracy >= 50:
            return "GUERREIRO"
        if proc_score >= 60:
            return "PROCRASTINADOR"
        if consistency_score < 40:
            return "INCONSISTENTE"
        if avg_accuracy < 50:
            return "ANSIOSO"
        return "INCONSISTENTE"


# ═══════════════════════════════════════════════════════════════════════════
# ─── BOT DE EXECUÇÃO (lógica de eventos e intervenções) ────────────────────
# ═══════════════════════════════════════════════════════════════════════════

class ExecutionBot:
    """
    Reage a eventos em tempo real e determina intervenções.

    Eventos → Reações:
    USER_STARTED_TASK → registra início, começa monitoramento
    USER_DELAYED → ajusta plano, envia alerta
    USER_FAILED_DAY → marca dia, simplifica amanhã
    LOW_PERFORMANCE → ativa force ou muda estratégia
    INACTIVITY → intervenção de procrastinação
    TASK_SKIPPED → detecta padrão de fuga
    HIGH_PERFORMANCE → reforço positivo
    EXAM_APPROACHING → escalona para modo guerra
    """

    # Tempo máximo de inatividade antes de alertar (minutos)
    INACTIVITY_THRESHOLD = 45
    # Mínimo de questões para análise de desempenho
    MIN_QUESTIONS_FOR_ANALYSIS = 10
    # Taxa de queda de desempenho que ativa intervenção
    PERFORMANCE_DROP_THRESHOLD = 15  # pontos percentuais

    def react_to_event(self, request: EventReactionRequest) -> Dict:
        """
        Decide ação do sistema baseado no evento recebido.
        Retorna: notificação, ação recomendada, mudança de modo.
        """
        event = request.eventType
        context = request.context
        profile = request.profile or ProfileData()

        reactions = {
            "TAREFA_INICIADA": self._on_task_started,
            "TAREFA_CONCLUIDA": self._on_task_completed,
            "TAREFA_ABANDONADA": self._on_task_abandoned,
            "TAREFA_PULADA": self._on_task_skipped,
            "INATIVIDADE_DETECTADA": self._on_inactivity,
            "BAIXO_DESEMPENHO": self._on_low_performance,
            "ALTO_DESEMPENHO": self._on_high_performance,
            "SIMULADO_CONCLUIDO": self._on_simulado_completed,
            "RETORNO_APOS_AUSENCIA": self._on_user_returned,
            "SESSAO_ENCERRADA": self._on_session_ended,
        }

        handler = reactions.get(event, self._on_generic_event)
        return handler(context, profile)

    def _on_task_started(self, ctx: Dict, profile: ProfileData) -> Dict:
        return {
            "action": "MONITOR_START",
            "notification": None,
            "message": "Tarefa iniciada. Monitorizando execucao.",
            "inactivityAlert": self.INACTIVITY_THRESHOLD,
        }

    def _on_task_completed(self, ctx: Dict, profile: ProfileData) -> Dict:
        xp = ctx.get("xp", 10)
        subject = ctx.get("subject", "")
        return {
            "action": "REWARD",
            "notification": {
                "title": "Tarefa concluida!",
                "body": f"+{xp} XP. Continue! {self._get_next_action_tip(profile)}",
                "type": "POSITIVO",
            },
            "triggerNextAction": True,
        }

    def _on_task_abandoned(self, ctx: Dict, profile: ProfileData) -> Dict:
        minutes_spent = ctx.get("minutesSpent", 0)
        behavior = profile.behaviorType or "INCONSISTENTE"

        if minutes_spent < 5:
            # Nem tentou de verdade
            return {
                "action": "FORCE_MICRO_ACTION",
                "notification": {
                    "title": "Nao desista!",
                    "body": "Faca apenas 5 minutos. Comece agora. Voce pode parar depois de 5 min.",
                    "type": "PROCRASTINACAO",
                },
                "suggestion": "MICRO_ACTION",
            }
        else:
            return {
                "action": "REPLAN_SUGGESTION",
                "notification": {
                    "title": "Tarefa pausada",
                    "body": "Tudo bem pausar. Replaneje o resto do dia para nao perder o momentum.",
                    "type": "INTELIGENCIA",
                },
                "suggestion": "REPLAN",
            }

    def _on_task_skipped(self, ctx: Dict, profile: ProfileData) -> Dict:
        skipped_subject = ctx.get("subject", "")
        skip_count = ctx.get("skipCount", 1)

        if skip_count >= 3:
            # Padrão de fuga confirmado
            return {
                "action": "CONFRONT_AVOIDANCE",
                "notification": {
                    "title": "Voce esta evitando algo",
                    "body": (
                        f"Esta e a {skip_count}a vez que voce pula {skipped_subject or 'essa tarefa'}. "
                        "O sistema detectou fuga. Vamos enfrentar isso juntos: 10 minutos agora."
                    ),
                    "type": "PROCRASTINACAO",
                },
                "modeChange": "FORCA_BRUTA" if skip_count >= 5 else None,
            }
        return {
            "action": "LOG_SKIP",
            "notification": None,
        }

    def _on_inactivity(self, ctx: Dict, profile: ProfileData) -> Dict:
        minutes_inactive = ctx.get("minutesInactive", 0)
        behavior = profile.behaviorType or "INCONSISTENTE"

        if minutes_inactive < 30:
            msg = "Ola! Voce ainda esta por ai? Proxima tarefa te espera."
        elif minutes_inactive < 60:
            msg = f"Voce esta parado ha {minutes_inactive} minutos. Faca a micro-acao de 10 minutos agora."
        else:
            msg = (
                f"Mais de 1 hora sem estudar. O dia esta escorregando. "
                "Se voce nao consegue estudar agora, ative o modo Cansado e faca o minimo."
            )

        return {
            "action": "INACTIVITY_ALERT",
            "notification": {
                "title": "Sistema de Atencao Ativo",
                "body": msg,
                "type": "PROCRASTINACAO",
            },
            "suggestion": "MICRO_ACTION" if minutes_inactive >= 60 else "RESUME",
        }

    def _on_low_performance(self, ctx: Dict, profile: ProfileData) -> Dict:
        accuracy = ctx.get("accuracy", 0)
        subject = ctx.get("subject", "")

        if accuracy < 40:
            return {
                "action": "EMERGENCY_INTERVENTION",
                "notification": {
                    "title": f"Desempenho critico em {subject}",
                    "body": (
                        f"Taxa de acerto de apenas {accuracy}% em {subject}. "
                        "O sistema vai ativar o Modo Forca Bruta para essa disciplina."
                    ),
                    "type": "INTELIGENCIA",
                },
                "modeChange": "FORCA_BRUTA",
                "targetSubject": subject,
            }
        elif accuracy < 60:
            return {
                "action": "STRATEGY_CHANGE",
                "notification": {
                    "title": f"Reforco necessario em {subject}",
                    "body": (
                        f"{accuracy}% de acerto em {subject}. "
                        "Revise a teoria antes de continuar com questoes."
                    ),
                    "type": "INTELIGENCIA",
                },
                "suggestion": "REVIEW_THEORY",
            }
        return {"action": "LOG", "notification": None}

    def _on_high_performance(self, ctx: Dict, profile: ProfileData) -> Dict:
        accuracy = ctx.get("accuracy", 0)
        subject = ctx.get("subject", "")

        return {
            "action": "POSITIVE_REINFORCEMENT",
            "notification": {
                "title": f"Excelente desempenho em {subject}!",
                "body": (
                    f"{accuracy}% de acerto! Voce esta dominando {subject}. "
                    "Hora de aumentar a dificuldade ou avancar para o proximo topico."
                ),
                "type": "INTELIGENCIA",
            },
            "suggestion": "ADVANCE_TOPIC",
        }

    def _on_simulado_completed(self, ctx: Dict, profile: ProfileData) -> Dict:
        score = ctx.get("score", 0)
        subject_scores = ctx.get("subjectScores", {})

        weak_in_simulado = [s for s, acc in subject_scores.items() if acc < 50]

        msg = f"Simulado concluido: {score}%. "
        if weak_in_simulado:
            msg += f"Disciplinas criticas: {', '.join(weak_in_simulado)}. Revisao obrigatoria agora."
        else:
            msg += "Bom resultado! Foque nos erros antes de continuar."

        return {
            "action": "POST_SIMULADO_REVIEW",
            "notification": {
                "title": f"Simulado: {score}%",
                "body": msg,
                "type": "SIMULADO",
            },
            "mandatoryNext": "ERROR_REVIEW",
            "weakSubjects": weak_in_simulado,
        }

    def _on_user_returned(self, ctx: Dict, profile: ProfileData) -> Dict:
        days_absent = ctx.get("daysAbsent", 0)

        if days_absent > 14:
            mode = "RETORNO"
            msg = (
                f"Bem-vindo de volta apos {days_absent} dias! "
                "Plano de retorno gradual ativado. Vamos comecar com calma."
            )
        else:
            mode = None
            msg = f"Voce estava ausente por {days_absent} dias. Vamos retomar do ponto em que parou."

        return {
            "action": "WELCOME_BACK",
            "notification": {
                "title": "Que bom ter voce de volta!",
                "body": msg,
                "type": "INTELIGENCIA",
            },
            "modeChange": mode,
            "generateNewPlan": True,
        }

    def _on_session_ended(self, ctx: Dict, profile: ProfileData) -> Dict:
        minutes = ctx.get("totalMinutes", 0)
        tasks_completed = ctx.get("tasksCompleted", 0)

        if tasks_completed == 0 and minutes < 10:
            return {
                "action": "ENCOURAGE",
                "notification": {
                    "title": "Sessao muito curta",
                    "body": "Amanha comece com a micro-acao assim que acordar. 10 minutos mudam tudo.",
                    "type": "INTELIGENCIA",
                },
            }

        return {
            "action": "SESSION_SUMMARY",
            "notification": {
                "title": f"Sessao encerrada: {minutes} min",
                "body": f"{tasks_completed} tarefa(s) concluida(s). Ate amanha!",
                "type": "INTELIGENCIA",
            },
        }

    def _on_generic_event(self, ctx: Dict, profile: ProfileData) -> Dict:
        return {"action": "LOG", "notification": None}

    def _get_next_action_tip(self, profile: ProfileData) -> str:
        behavior = profile.behaviorType or "INCONSISTENTE"
        tips = {
            "PROCRASTINADOR": "Nao pare agora — o momento e seu!",
            "ANSIOSO": "Voce esta indo bem. Um passo de cada vez.",
            "DISCIPLINADO": "Excelente. Siga o plano.",
            "INCONSISTENTE": "Mantenha o ritmo. Consistencia e tudo.",
            "GUERREIRO": "Guerreiro nao para. Proxima tarefa!",
        }
        return tips.get(behavior, "Proxima tarefa!")


# ─── Instâncias globais (singleton) ──────────────────────────────────────

decision_engine = DecisionEngine()
analysis_bot = AnalysisBot()
execution_bot = ExecutionBot()
