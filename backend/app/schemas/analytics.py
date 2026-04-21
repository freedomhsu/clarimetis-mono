from pydantic import BaseModel


class WellnessInsight(BaseModel):
    category: str
    observation: str
    trend: str | None  # "improving" | "declining" | "stable"


class Recommendation(BaseModel):
    type: str  # "book" | "practice" | "course" | "strategy"
    title: str
    description: str
    why: str


class PrimaryLoop(BaseModel):
    topic: str           # e.g. "Scarcity/Dating"
    frequency: int       # estimated mention count in recent sessions
    efficiency: int      # 0–100: current cognitive operating efficiency
    fix_type: str        # e.g. "Perspective Shift (Growth Mindset)"


class RelationalObservation(BaseModel):
    person: str               # "spouse", "boss", "colleague", etc.
    quality: str              # positive quality detected
    evidence: str             # brief quote/paraphrase from conversation
    suggested_action: str
    relationship_score: int | None  # 0–100, null = insufficient data


class PriorityItem(BaseModel):
    rank: int
    category: str        # "Regulation" | "Relational" | "Growth" | "Career" | "Health"
    action: str
    reasoning: str
    urgency: str         # "critical" | "high" | "medium" | "low"


class AnalyticsSummary(BaseModel):
    total_sessions: int
    total_messages: int
    # Data reliability — drives "not enough info" UI states
    data_reliability: str        # "insufficient" | "low" | "moderate" | "high"
    # Psychological scores (null = insufficient data to estimate reliably)
    confidence_score: int | None     # 0–100
    anxiety_score: int | None        # 0–100
    self_esteem_score: int | None    # 0–100
    # System telemetry
    stress_load: int | None          # 0–100
    cognitive_noise: str | None      # "low" | "moderate" | "high"
    # Multiple logic loops (previously single primary_loop)
    logic_loops: list[PrimaryLoop]
    # Core insights & recommendations
    insights: list[WellnessInsight]
    recommendations: list[Recommendation]
    focus_areas: list[str]
    # Relational Capital
    relational_observations: list[RelationalObservation]
    social_gratitude_index: int | None   # 0–100
    # Priority Stack
    priority_stack: list[PriorityItem]
    generated_at: str


class ScorePoint(BaseModel):
    date: str
    confidence: int | None
    anxiety: int | None
    self_esteem: int | None
    stress: int | None
    social: int | None


class ScoreHistory(BaseModel):
    points: list[ScorePoint]
