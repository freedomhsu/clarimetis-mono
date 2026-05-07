from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# Shared integer score type: validated to the 0–100 range produced by Gemini.
# Using Annotated + Field here means any value outside the range (e.g. 150)
# causes a ValidationError immediately at parse time rather than silently
# reaching the client or being stored in the DB.
Score = Annotated[int, Field(ge=0, le=100)]

# Allowed reliability tiers — drives caching decisions and UI state machines.
Reliability = Literal["insufficient", "low", "moderate", "high"]


class WellnessInsight(BaseModel):
    model_config = ConfigDict(extra="ignore")

    category: str  # "Stress" | "Relationships" | "Growth" | "Health" | "Career" | "Mindset"
    observation: str
    # Literal ensures the frontend's trend-arrow logic never receives garbage.
    trend: Literal["improving", "declining", "stable"] | None = None


class Recommendation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Literal drives icon selection in the UI — must be one of the known types.
    type: Literal["book", "practice", "course", "strategy"]
    title: str
    description: str
    why: str


class PrimaryLoop(BaseModel):
    model_config = ConfigDict(extra="ignore")

    topic: str            # e.g. "Scarcity/Dating"
    frequency: int = Field(ge=0)  # estimated mention count in recent sessions
    efficiency: Score     # 0–100: current cognitive operating efficiency
    fix_type: str         # e.g. "Perspective Shift (Growth Mindset)"


class RelationalObservation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    person: str                   # "spouse", "boss", "colleague", etc.
    quality: str                  # positive quality detected
    evidence: str                 # brief quote/paraphrase from conversation
    suggested_action: str
    relationship_score: Score | None = None  # null = insufficient data


class PriorityItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    rank: int = Field(ge=1)
    category: str  # "Regulation" | "Relational" | "Growth" | "Career" | "Health"
    action: str
    reasoning: str
    # Literal drives colour-coding and sorting in the UI.
    urgency: Literal["critical", "high", "medium", "low"]


class AnalyticsSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    total_sessions: int = Field(ge=0)
    total_messages: int = Field(ge=0)
    # Reliability drives the "not enough info" UI state and caching decisions.
    data_reliability: Reliability
    # Psychological scores — null means insufficient data to estimate reliably.
    confidence_score: Score | None = None       # 0–100
    anxiety_score: Score | None = None          # 0–100
    self_esteem_score: Score | None = None      # 0–100
    ego_score: Score | None = None              # 0–100
    emotion_control_score: Score | None = None  # 0–100
    self_awareness_score: Score | None = None   # 0–100
    motivation_score: Score | None = None       # 0–100
    # System telemetry
    stress_load: Score | None = None           # 0–100
    cognitive_noise: Literal["low", "moderate", "high"] | None = None
    # Multiple logic loops (previously single primary_loop)
    logic_loops: list[PrimaryLoop] = Field(default_factory=list)
    # Core insights & recommendations
    insights: list[WellnessInsight] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)
    focus_areas: list[str] = Field(default_factory=list)
    # Relational Capital
    relational_observations: list[RelationalObservation] = Field(default_factory=list)
    social_gratitude_index: Score | None = None  # 0–100
    # Priority Stack
    priority_stack: list[PriorityItem] = Field(default_factory=list)
    generated_at: str


class ScorePoint(BaseModel):
    model_config = ConfigDict(extra="ignore")

    date: str
    confidence: Score | None = None
    anxiety: Score | None = None
    self_esteem: Score | None = None
    stress: Score | None = None
    social: Score | None = None
    ego: Score | None = None
    emotion_control: Score | None = None
    self_awareness: Score | None = None
    motivation: Score | None = None


class ScoreHistory(BaseModel):
    model_config = ConfigDict(extra="ignore")

    points: list[ScorePoint]
