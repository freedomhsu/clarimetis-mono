"""Tier-1 knowledge base seeder.

Inserts RET protocols, CBT frameworks, and cognitive bias definitions into
the knowledge_docs table, generates embeddings for each via Vertex AI, and
is fully idempotent (skips docs whose title already exists).

Also fetches the `buley/cognitive-biases` HuggingFace dataset (CC BY 4.0)
and seeds `definition`-sourced entries, which include observable language
markers and coaching reframes per bias.

Usage (from repo root):
    cd backend
    uv run python scripts/seed_knowledge.py
"""

import asyncio
import json
import os
import sys

# Allow running from both the repo root and the backend/ directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx
import vertexai
from sqlalchemy import select, text
from vertexai.language_models import TextEmbeddingModel

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.knowledge_doc import KnowledgeDoc
from app.services.gcp_credentials import get_gcp_credentials

# ---------------------------------------------------------------------------
# Knowledge documents
# ---------------------------------------------------------------------------

DOCS: list[dict] = [
    # ── RET / REBT ──────────────────────────────────────────────────────────
    {
        "title": "The ABC Model of Emotional Disturbance (REBT)",
        "category": "RET",
        "content": (
            "The ABC model is the foundation of Rational Emotive Behaviour Therapy (REBT, Albert Ellis). "
            "A = Activating Event (a situation or trigger). "
            "B = Belief — rational or irrational interpretation of A. "
            "C = Consequence — the emotional and behavioural result. "
            "Key insight: A does not directly cause C. It is B that determines C. "
            "Losing a job (A) does not automatically cause depression (C); "
            "the belief 'I am worthless and will never succeed' (irrational B) causes it, "
            "while 'This is difficult but I can handle it and find another path' (rational B) "
            "leads to disappointment but not despair. "
            "Coaching implication: help the user examine their B's, not just their A's."
        ),
    },
    {
        "title": "Ellis's Core Irrational Beliefs",
        "category": "RET",
        "content": (
            "Albert Ellis identified four core patterns of irrational belief: "
            "(1) Demandingness — converting preferences into absolute musts: 'I must succeed', "
            "'They must treat me fairly', 'Life must be easy.' "
            "(2) Awfulising — rating setbacks as catastrophically terrible: 'It's awful, I can't stand it.' "
            "(3) Low Frustration Tolerance (LFT) — 'I can't stand this' when one actually can. "
            "(4) Self/Other-Downing — globally rating oneself or others as worthless based on a single failure. "
            "Antidote: unconditional self-acceptance (USA) — separating behaviour from worth. "
            "Language markers to listen for: 'must', 'should', 'have to', 'can't stand it', 'it's terrible/awful', "
            "'I'm a failure/idiot/worthless'. These signal irrational belief patterns."
        ),
    },
    {
        "title": "ABCDE Disputation Method (REBT)",
        "category": "RET",
        "content": (
            "The full REBT model extends ABC to ABCDE: "
            "D = Disputation (actively challenging the irrational belief). "
            "E = Effective New Belief — a rational replacement belief. "
            "Three types of disputation: "
            "Empirical — 'What is the actual evidence for and against this belief?' "
            "Logical — 'Does this conclusion logically follow from the facts?' "
            "Pragmatic — 'Is holding this belief helping or harming you?' "
            "Additional disputation questions: "
            "'Would I advise a close friend to hold this belief?' "
            "'Is demanding this outcome realistic?' "
            "'Does failing at this make me totally worthless, or did I fail at one thing?' "
            "Coaching implication: after identifying the irrational B, guide the user through D "
            "then collaboratively construct E — a more rational, evidence-based alternative belief "
            "that acknowledges difficulty without catastrophising."
        ),
    },
    {
        "title": "Rational Emotive Imagery (REBT)",
        "category": "RET",
        "content": (
            "Rational Emotive Imagery (REI) is a REBT technique for changing emotional responses at the felt level. "
            "Negative REI: vividly imagine the worst-case activating event, allow the disturbed emotion to arise, "
            "then work to change it — not to a fake positive, but to a healthy negative (concern instead of anxiety, "
            "sadness instead of depression, irritation instead of rage). "
            "Positive REI: imagine coping successfully with the feared situation; reinforce the rational belief. "
            "Coaching implication: use when a user can articulate the rational belief intellectually "
            "but still feels the disturbed emotion. REI bridges cognitive insight and felt emotional change. "
            "Ask: 'Can you picture that situation clearly? Now, while keeping the picture, can you notice "
            "if you can shift from anxiety to concern — not by telling yourself it doesn't matter, "
            "but by reminding yourself you can handle it even if it's very unpleasant?'"
        ),
    },
    # ── CBT ─────────────────────────────────────────────────────────────────
    {
        "title": "Beck's Cognitive Triad",
        "category": "CBT",
        "content": (
            "Aaron Beck's cognitive triad describes three domains of negative thinking common in depression and anxiety: "
            "(1) Negative view of self — 'I am defective, worthless, inadequate, unlovable.' "
            "(2) Negative view of the world / current experience — 'The world is unfair, everything is an obstacle, "
            "my experiences confirm I am failing.' "
            "(3) Negative view of the future — 'Nothing will ever improve, I am hopeless, things will only get worse.' "
            "These three views mutually reinforce each other. "
            "Coaching implication: identify which leg of the triad is most active in the user's language. "
            "'I always fail' → self-domain. 'Nobody ever helps me' → world-domain. "
            "'Things will never change' → future-domain. "
            "Target the most active leg with Socratic questioning and evidence examination."
        ),
    },
    {
        "title": "Automatic Thoughts, Intermediate Beliefs, and Core Beliefs (CBT)",
        "category": "CBT",
        "content": (
            "CBT organises thoughts in three layers: "
            "Surface — Automatic Thoughts: fast, situation-specific, often negative. "
            "Example: 'I can't do this presentation.' "
            "Middle — Intermediate Beliefs: conditional rules and assumptions. "
            "Example: 'If I fail, people will think I'm incompetent.' "
            "Deep — Core Beliefs: fundamental schemas about self, others, and the world, "
            "formed in childhood and reinforced over time. "
            "Example: 'I am fundamentally incompetent.' "
            "Technique — the downward arrow: keep asking 'If that were true, what would that mean about you?' "
            "until the core belief is reached. "
            "Coaching implication: don't stop at the surface automatic thought. "
            "When a user says 'I messed up the meeting', gently use the downward arrow "
            "to explore whether this connects to a deeper core belief about adequacy or worth."
        ),
    },
    {
        "title": "Cognitive Restructuring Technique (CBT)",
        "category": "CBT",
        "content": (
            "Cognitive restructuring is the core CBT technique for modifying dysfunctional thoughts. "
            "Steps: "
            "(1) Identify the automatic thought precisely. "
            "(2) Rate belief in it (0–100%) and emotional distress (0–100). "
            "(3) Identify the cognitive distortion type. "
            "(4) Examine evidence FOR the thought. "
            "(5) Examine evidence AGAINST the thought. "
            "(6) Generate a balanced, realistic alternative thought — not forced positivity, "
            "but an evidence-based middle ground. "
            "(7) Re-rate belief and distress. "
            "The best-friend test: 'What would you say to a close friend who had this thought?' "
            "usually generates the balanced alternative naturally. "
            "Coaching implication: use when a user returns repeatedly to one high-distress thought. "
            "Focus on high-belief (>60%), high-distress thoughts — not every passing thought."
        ),
    },
    {
        "title": "Behavioural Activation (CBT)",
        "category": "CBT",
        "content": (
            "Behavioural activation (BA) addresses the depression-inactivity cycle: "
            "low mood → withdrawal → less positive reinforcement → lower mood. "
            "Core principle: action precedes motivation, not the other way around. "
            "Do not wait until you feel better to start — start to feel better. "
            "Activity monitoring: the user rates daily activities for mastery (sense of accomplishment, 0–10) "
            "and pleasure (0–10) to identify what actually elevates mood. "
            "Schedule activities before motivation appears, starting with very small, achievable steps. "
            "Graded task assignment: break a feared or avoided task into micro-steps, "
            "completing each before moving to the next. "
            "Coaching implication: when a user is in a low-energy or avoidant state, "
            "ask 'What is one small thing — even 10 minutes — you could do in the next 24 hours "
            "that might give you a feeling of accomplishment or small pleasure?'"
        ),
    },
    {
        "title": "Socratic Questioning in CBT",
        "category": "CBT",
        "content": (
            "Socratic questioning is the primary method of guided discovery in CBT — "
            "the therapist asks questions rather than correcting or reassuring. "
            "Types of Socratic questions: "
            "Clarifying — 'What exactly do you mean by that?' "
            "Evidence — 'What makes you think that? What's the evidence against it?' "
            "Assumptions — 'Are you assuming this is definitely true? How do you know?' "
            "Implications — 'If that were true, what would it mean? What would follow from that?' "
            "Alternative perspectives — 'Is there another way to see this? "
            "What would someone who sees this differently say?' "
            "What NOT to do: don't argue, lecture, provide the answer, or challenge in a way that feels like attack. "
            "Coaching implication: curiosity is the mechanism. Ask genuinely. "
            "If the user feels interrogated, slow down and validate before continuing."
        ),
    },
    {
        "title": "Mindfulness-Based Cognitive Therapy (MBCT) — Decentring",
        "category": "CBT",
        "content": (
            "MBCT (Segal, Williams, Teasdale) integrates mindfulness with CBT, primarily for depressive relapse prevention. "
            "Core skill: decentring — observing thoughts as mental events rather than facts about reality. "
            "'I notice I am having the thought that I am worthless' versus 'I am worthless.' "
            "This metacognitive shift reduces cognitive fusion (identifying with thoughts). "
            "Three-minute breathing space (a portable practice): "
            "(1) Awareness — what am I experiencing right now in thoughts, feelings, body sensations? "
            "(2) Gathering — narrow attention to physical sensations of breathing. "
            "(3) Expanding — broaden attention to the whole body and surrounding space. "
            "Coaching implication: when a user is caught in a thought loop, "
            "use decentring language: 'I notice you're having the thought that...' "
            "This creates distance without invalidating the experience."
        ),
    },
    # ── Cognitive Biases ────────────────────────────────────────────────────
    {
        "title": "Cognitive Distortions Overview (Burns/Beck)",
        "category": "cognitive_bias",
        "content": (
            "Cognitive distortions are systematic, habitual patterns of biased thinking. "
            "Key types: "
            "All-or-nothing thinking — binary categories, no middle ground. "
            "Overgeneralisation — one event becomes a universal pattern ('I always', 'I never'). "
            "Mental filter — fixating on a single negative and ignoring all positives. "
            "Disqualifying the positive — dismissing positive experiences as flukes. "
            "Jumping to conclusions — mind reading (inferring others' thoughts) or fortune-telling (predicting failure). "
            "Catastrophising — magnifying negatives to disaster level. "
            "Emotional reasoning — 'I feel bad, therefore things are bad.' "
            "Should statements — rigid rules generating guilt (self-directed) or resentment (other-directed). "
            "Labelling — 'I am a failure' rather than 'I made a mistake'. "
            "Personalisation — taking undue responsibility for external events. "
            "Coaching implication: naming the distortion without judgment reduces its power. "
            "Awareness is the first intervention."
        ),
    },
    {
        "title": "Catastrophising: Recognition and Decatastrophising",
        "category": "cognitive_bias",
        "content": (
            "Catastrophising treats a negative outcome as though it were an unrecoverable catastrophe. "
            "Language markers: 'What if everything falls apart?', 'I can't handle this', "
            "'This will ruin everything', 'I'll never recover from this.' "
            "Two forms: rumination catastrophising (dwelling on current distress) "
            "and future-oriented catastrophising (imagining worst-case outcomes). "
            "Decatastrophising technique: "
            "'What is the realistic worst-case outcome?' "
            "'What is the most likely outcome?' "
            "'If the worst happened, what resources or actions do you have to cope?' "
            "'Has anything this bad happened before? How did you get through it?' "
            "'What's one action you could take right now to reduce this risk?' "
            "Coaching implication: acknowledge the fear as real first, "
            "then test the proportionality and survivability of the predicted outcome."
        ),
    },
    {
        "title": "All-or-Nothing Thinking and Overgeneralisation",
        "category": "cognitive_bias",
        "content": (
            "All-or-nothing (dichotomous) thinking places experience in absolute binary categories: "
            "success/failure, perfect/worthless, loved/hated. No middle ground exists. "
            "Common in perfectionism, anxiety, and eating disorders. "
            "Language markers: 'completely', 'totally', 'always', 'never', 'either/or', 'ruined'. "
            "Grey-zone intervention: 'Is there anything in between these two poles?' "
            "'On a scale of 0–100 rather than 0 or 100, where would you rate this?' "
            "'Has there ever been a partial success here?' "
            "Overgeneralisation: one event becomes evidence of a universal pattern. "
            "'I failed this interview → I always fail → I'm unemployable.' "
            "Language markers: 'always', 'never', 'every time', 'everyone', 'no one'. "
            "Specificity intervention: 'Has this always happened, or was this one instance?' "
            "'What percentage of the time does this actually occur?' "
            "Coaching implication: both distortions often underlie intense self-criticism. "
            "Help the user find the specific exception or the middle ground."
        ),
    },
    {
        "title": "Emotional Reasoning and Should Statements",
        "category": "cognitive_bias",
        "content": (
            "Emotional reasoning: using an emotional state as factual evidence about reality. "
            "'I feel like a failure, therefore I am a failure.' "
            "'I feel guilty, so I must have done something wrong.' "
            "The feeling is real and valid; the inference from it to a factual conclusion may not be. "
            "Intervention: 'Your feeling makes complete sense given how you see this. "
            "What is the evidence independent of the feeling?' "
            "Should statements (Ellis's musts): rigid prescriptive rules about how self, others, or "
            "the world must behave. "
            "Self-directed → guilt. Other-directed → resentment. World-directed → frustration. "
            "Examples: 'I should be further along by now', 'They should appreciate what I do', "
            "'Life should be fair.' "
            "Intervention: convert 'should' to 'I would prefer' and explore the underlying preference. "
            "Ask: 'Where did this rule come from? Is it a value you chose or one you inherited?' "
            "Coaching implication: 'should' is almost always worth exploring — "
            "it usually reveals an unexamined expectation or a values conflict."
        ),
    },
    {
        "title": "Labelling and Personalisation",
        "category": "cognitive_bias",
        "content": (
            "Labelling: attaching a global, fixed identity label based on a specific behaviour. "
            "'I made a mistake → I'm stupid.' "
            "'I lost my temper once → I'm an abusive person.' "
            "Labels are totalising and permanent; behaviours are specific and changeable. "
            "Intervention: 'You're describing a behaviour, not a person. "
            "What is the specific behaviour?' Then separate performance from worth. "
            "Personalisation: taking excessive personal responsibility for events outside one's control. "
            "'My child is unhappy → I'm a bad parent.' "
            "'The project failed → it's my fault.' "
            "Personalisation ignores situational, systemic, and other-person factors. "
            "Responsibility pie chart technique: list all factors contributing to the outcome "
            "and assign rough percentages; the user's contribution is usually much smaller than they assumed. "
            "Coaching implication: both distortions create disproportionate guilt and shame. "
            "Gentle specificity and the responsibility pie chart are the core tools."
        ),
    },
    # ── Frameworks ──────────────────────────────────────────────────────────
    {
        "title": "Window of Tolerance (Siegel)",
        "category": "framework",
        "content": (
            "The Window of Tolerance (Dan Siegel) describes the optimal arousal zone for functioning: "
            "regulated, present, able to think and feel simultaneously. "
            "Hyperarousal (above the window): panic, rage, overwhelm, flooding, hypervigilance, impulsivity. "
            "Hypoarousal (below the window): shutdown, numbness, dissociation, freeze, brain fog, flat affect. "
            "Hyperarousal interventions: physiological sigh (double inhale through nose, long exhale), "
            "4-7-8 breathing, cold water on face, sensory grounding (5-4-3-2-1). "
            "Hypoarousal interventions: gentle movement, change of environment, upbeat music, social contact, "
            "titrated activation (small action before insight). "
            "Coaching implication: identify which state the user is in before proceeding. "
            "Only explore emotionally charged content when the user is inside their window. "
            "If hyperaroused, regulate first. If hypoaroused, gently activate before exploring meaning."
        ),
    },
    {
        "title": "Polyvagal Theory — Safety and Threat Responses (Porges)",
        "category": "framework",
        "content": (
            "Stephen Porges' Polyvagal Theory describes three neural circuits governing social and threat responses: "
            "(1) Ventral Vagal — safe and social: connection, play, nuanced communication, learning are available. "
            "(2) Sympathetic — mobilise: fight or flight, threat detected, body prepared for action, "
            "social engagement narrows. "
            "(3) Dorsal Vagal — immobilise: freeze, collapse, shutdown — triggered when threat feels overwhelming "
            "and escape is impossible. "
            "Neuroception (automatic threat detection) is influenced by: vocal prosody (calm vs harsh tone), "
            "facial expressiveness, predictability, and physical safety cues. "
            "Co-regulation: a regulated nervous system calms dysregulated ones via social cues. "
            "Coaching implication: a user in dorsal vagal (flat, 'what's the point', disconnected) "
            "cannot process insight-based coaching. Co-regulate first with calm, consistent, warm presence. "
            "Offer safety before strategy."
        ),
    },
    {
        "title": "Self-Determination Theory — Autonomy, Competence, Relatedness (Deci & Ryan)",
        "category": "framework",
        "content": (
            "Self-Determination Theory (SDT, Deci & Ryan) identifies three universal psychological needs "
            "whose satisfaction predicts wellbeing and intrinsic motivation: "
            "Autonomy — feeling volitional choice and ownership over one's actions. "
            "'This is mine to do' versus 'I have to do this or else.' "
            "Competence — feeling effective and capable. "
            "Feedback and appropriate challenge both support competence. "
            "Relatedness — feeling genuinely connected to and cared about by others. "
            "When any need is chronically thwarted, wellbeing and motivation decline. "
            "Burnout signatures: thwarted autonomy (doing work that conflicts with values) "
            "or thwarted competence (unclear expectations, no feedback). "
            "Chronic loneliness despite social activity signals thwarted relatedness (connection without depth). "
            "Coaching implication: when a user is unmotivated or burned out, "
            "identify which need is most unmet, then help design changes to satisfy it."
        ),
    },
    {
        "title": "Acceptance and Commitment Therapy — Values and Experiential Avoidance (ACT)",
        "category": "framework",
        "content": (
            "ACT (Hayes, Strosahl, Wilson) targets psychological flexibility: the ability to contact "
            "present-moment experience fully and pursue valued action, even when difficult feelings are present. "
            "Experiential avoidance — attempting to suppress or escape unwanted internal experiences — "
            "paradoxically increases their intensity and frequency (thought suppression research). "
            "Values (ACT): freely chosen life directions, not goals. Goals are completed; values are ongoing compass directions. "
            "Key domains: family, intimate relationships, friendships, work, education, leisure, health, community, spirituality. "
            "Values clarification question: 'In this area of life, what kind of person do you want to be? "
            "What do you want to stand for?' "
            "Values-goals mismatch: pursuing a goal (promotion, income) that conflicts with a value "
            "(presence, creativity) creates chronic inner conflict and eventual burnout. "
            "Committed action: taking small, values-congruent steps despite discomfort. "
            "Coaching implication: when a user feels stuck, check values-action alignment. "
            "'If fear and tiredness weren't obstacles, what would you be doing?'"
        ),
    },
    {
        "title": "Perfectionism, Shame, and Growth Mindset",
        "category": "framework",
        "content": (
            "Perfectionism is not high standards — it is contingent self-worth: "
            "worth depends on performance. 'If I fail, I am worthless.' "
            "Healthy high standards: 'I want to do this well because it matters to me.' "
            "Perfectionism: 'I must do this perfectly or I am worthless.' "
            "Brené Brown's research: shame (global, identity-level — 'I am bad') versus "
            "guilt (specific, behaviour-level — 'I did something bad'). "
            "Shame predicts disengagement, secrecy, and self-destruction. "
            "Guilt predicts repair, learning, and growth. "
            "Carol Dweck's growth mindset: fixed mindset — 'I have fixed traits; "
            "failure reveals I lack the trait.' Growth mindset — 'I can develop through effort and strategy.' "
            "Fixed-mindset fear: effort is dangerous because it might prove you're not good enough. "
            "Coaching implication: when a user avoids trying, over-prepares, or catastrophises failure, "
            "explore the shame belief beneath it. "
            "Ask: 'What would it mean about you if you failed at this?' "
            "Then distinguish performance from worth."
        ),
    },
    {
        "title": "Stress-Performance Curve (Yerkes-Dodson Law)",
        "category": "framework",
        "content": (
            "The Yerkes-Dodson law describes an inverted-U relationship between arousal/stress and performance. "
            "Under-arousal zone: boredom, low engagement, underperformance, procrastination. "
            "Optimal zone: peak performance, flow state, engagement, clear thinking. "
            "Over-arousal zone: cognitive impairment, anxiety, errors, burnout, fight/flight. "
            "The optimal arousal level shifts with task complexity: "
            "simple tasks tolerate higher arousal; complex, creative tasks require lower arousal. "
            "Chronic high stress physically remodels the prefrontal cortex "
            "(impairing planning, decision-making, impulse control) "
            "and enlarges the amygdala (increasing threat reactivity). "
            "Coaching implication: help the user identify where they are on the curve. "
            "'Are you stretched (needs more challenge) or overwhelmed (needs load reduction)?' "
            "Under-stimulated users benefit from autonomy, challenge, and novel goals. "
            "Over-stimulated users need boundary-setting, recovery time, and task shedding."
        ),
    },
]


# ---------------------------------------------------------------------------
# Embedding and seeding logic
# ---------------------------------------------------------------------------

vertexai.init(
    project=settings.gcp_project_id,
    location=settings.gcp_location,
    credentials=get_gcp_credentials(),
)

_embedding_model: TextEmbeddingModel | None = None


def _get_embedding_model() -> TextEmbeddingModel:
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = TextEmbeddingModel.from_pretrained("text-embedding-004")
    return _embedding_model


def _embed(text: str) -> list[float]:
    model = _get_embedding_model()
    result = model.get_embeddings([text[:8000]])
    return result[0].values


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        # Apply the migration if the table doesn't exist yet
        await db.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS knowledge_docs (
                    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                    title      TEXT        NOT NULL,
                    content    TEXT        NOT NULL,
                    category   TEXT        NOT NULL,
                    embedding  vector(768),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        )
        await db.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_knowledge_docs_embedding "
                "ON knowledge_docs USING hnsw (embedding vector_cosine_ops) "
                "WITH (m = 16, ef_construction = 64)"
            )
        )
        await db.commit()

        existing = await db.execute(select(KnowledgeDoc.title))
        existing_titles = {row[0] for row in existing.fetchall()}

        inserted = 0
        skipped = 0
        for doc in DOCS:
            if doc["title"] in existing_titles:
                skipped += 1
                continue

            print(f"  Embedding: {doc['title']}")
            embedding = await asyncio.get_event_loop().run_in_executor(
                None, _embed, doc["title"] + "\n\n" + doc["content"]
            )

            db.add(
                KnowledgeDoc(
                    title=doc["title"],
                    content=doc["content"],
                    category=doc["category"],
                    embedding=embedding,
                )
            )
            await db.commit()
            inserted += 1

        print(f"\nHandwritten docs — {inserted} inserted, {skipped} skipped (already existed).")

        # ── HuggingFace dataset ──────────────────────────────────────────────
        await seed_hf(db)


# ---------------------------------------------------------------------------
# HuggingFace cognitive-biases dataset (CC BY 4.0)
# Only "definition"-sourced entries have prose-rich content suitable for RAG.
# ---------------------------------------------------------------------------

HF_JSONL_URL = (
    "https://huggingface.co/datasets/buley/cognitive-biases"
    "/resolve/main/biases/train.jsonl"
)


def _build_hf_bias_doc(entry: dict) -> dict | None:
    """Convert a dataset entry into a knowledge_doc dict.

    Returns None if the entry lacks enough content to be useful.
    """
    if entry.get("source") != "definition":
        return None
    definition = (entry.get("definition") or "").strip()
    if not definition:
        return None

    name: str = entry.get("name", entry.get("id", "Unknown")).replace("_", " ")
    title = f"{name} (Cognitive Bias)"

    parts: list[str] = [definition]

    core_pattern = (entry.get("core_pattern") or "").strip()
    if core_pattern:
        parts.append(f"Core pattern: {core_pattern}")

    domain = (entry.get("domain") or "").replace("_", " ").title()
    if domain:
        parts.append(f"Cognitive domain: {domain}")

    markers: list[str] = entry.get("observable_markers") or []
    if markers:
        parts.append("Observable language markers: " + "; ".join(f'"{m}"' for m in markers))

    insight = (entry.get("low_entropy_insight") or "").strip()
    if insight:
        parts.append(f"Coaching reframe: {insight}")

    examples: list[str] = entry.get("examples") or []
    if examples:
        parts.append("Examples: " + "; ".join(examples))

    research = (entry.get("research_notes") or "").strip()
    if research:
        parts.append(f"Notes: {research}")

    return {
        "title": title,
        "category": "cognitive_bias",
        "content": "\n".join(parts),
    }


async def _fetch_hf_docs() -> list[dict]:
    """Download and parse the JSONL; return embeddable docs."""
    print(f"\nFetching HuggingFace dataset from:\n  {HF_JSONL_URL}")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(HF_JSONL_URL, follow_redirects=True)
        resp.raise_for_status()

    docs: list[dict] = []
    for line in resp.text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        doc = _build_hf_bias_doc(entry)
        if doc:
            docs.append(doc)

    print(f"  {len(docs)} definition-sourced entries found.")
    return docs


async def seed_hf(db_session) -> None:
    """Seed HuggingFace bias docs into an already-open session."""
    hf_docs = await _fetch_hf_docs()

    existing = await db_session.execute(select(KnowledgeDoc.title))
    existing_titles = {row[0] for row in existing.fetchall()}

    inserted = 0
    skipped = 0
    for doc in hf_docs:
        if doc["title"] in existing_titles:
            skipped += 1
            continue

        print(f"  Embedding: {doc['title']}")
        embedding = await asyncio.get_event_loop().run_in_executor(
            None, _embed, doc["title"] + "\n\n" + doc["content"]
        )

        db_session.add(
            KnowledgeDoc(
                title=doc["title"],
                content=doc["content"],
                category=doc["category"],
                embedding=embedding,
            )
        )
        await db_session.commit()
        inserted += 1
        existing_titles.add(doc["title"])

    print(f"HuggingFace biases — {inserted} inserted, {skipped} skipped.")


if __name__ == "__main__":
    asyncio.run(seed())
