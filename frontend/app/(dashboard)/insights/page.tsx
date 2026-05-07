// frontend/app/(dashboard)/insights/page.tsx
"use client";

import { type ReactNode, type ElementType, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import {
  BarChart2,
  BookOpen,
  Brain,
  MessageCircle,
  Loader2,
  RefreshCw,
  Heart,
  Users,
  Zap,
  Star,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Lock,
  ArrowUpRight,
  Flame,
  Shield,
  Eye,
  Target,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  api,
  type AnalyticsSummary,
  type ScoreHistory,
  type ScorePoint,
  type SubscriptionError,
} from "@/lib/api";
import { deduplicateScorePoints } from "@/lib/analyticsUtils";
import { useI18n } from "@/components/providers/I18nContext";

// ── Lookup tables ─────────────────────────────────────────────────────────────

const TREND_ICON: Record<string, ReactNode> = {
  improving: <TrendingUp size={13} className="text-green-500" />,
  declining:  <TrendingDown size={13} className="text-red-500" />,
  stable:     <Minus size={13} className="text-gray-400" />,
};

const TREND_COLOR: Record<string, string> = {
  improving: "text-green-500 dark:text-green-400",
  declining:  "text-red-500 dark:text-red-400",
  stable:     "text-gray-400",
};

const TYPE_ICON: Record<string, ReactNode> = {
  book:     <BookOpen size={15} />,
  course:   <BarChart2 size={15} />,
  practice: <Brain size={15} />,
  strategy: <Zap size={15} />,
};

const URGENCY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  high:     "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  medium:   "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  low:      "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const CATEGORY_ICON: Record<string, ReactNode> = {
  Regulation: <Brain size={14} />,
  Relational: <Users size={14} />,
  Growth:     <TrendingUp size={14} />,
  Career:     <BarChart2 size={14} />,
  Health:     <Heart size={14} />,
};

// Reliability ─────────────────────────────────────────────────────────────────

const RELIABILITY_SIGNAL: Record<string, number> = {
  insufficient: 1,
  low:          2,
  moderate:     3,
  high:         4,
};

/** Active bar colour for the signal-strength visualiser. */
const RELIABILITY_BAR_COLOR: Record<string, string> = {
  insufficient: "bg-slate-400",
  low:          "bg-amber-500 dark:bg-amber-400",
  moderate:     "bg-blue-500 dark:bg-blue-400",
  high:         "bg-green-500 dark:bg-green-400",
};

/** Text colour for the reliability headline. */
const RELIABILITY_TEXT_COLOR: Record<string, string> = {
  insufficient: "text-slate-500",
  low:          "text-amber-700 dark:text-amber-400",
  moderate:     "text-blue-700 dark:text-blue-400",
  high:         "text-green-700 dark:text-green-400",
};

/** Container background + border for the reliability callout. */
const RELIABILITY_CONTAINER: Record<string, string> = {
  insufficient: "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700",
  low:          "bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800",
  moderate:     "bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800",
  high:         "bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800",
};

// Cognitive noise ─────────────────────────────────────────────────────────────

const COGNITIVE_NOISE_BADGE: Record<string, string> = {
  high:     "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  moderate: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  low:      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

const COGNITIVE_NOISE_BAR_COLOR: Record<string, string> = {
  high:     "bg-red-400 dark:bg-red-500",
  moderate: "bg-yellow-400 dark:bg-yellow-500",
  low:      "bg-emerald-400 dark:bg-emerald-500",
};

/** How many of the 12 audio-meter bars to light for each noise level. */
const COGNITIVE_NOISE_LIT: Record<string, number> = {
  high:     12,
  moderate: 8,
  low:      4,
};

// ScoreGauge colour helpers ────────────────────────────────────────────────────
// colorFn returns a Tailwind text-colour class (e.g. "text-green-500").
// These two tables map that class to hex (for CSS boxShadow) and a gradient
// tint (for the card background), eliminating the fragile `.includes()` checks
// that would silently break if Tailwind class names ever change.

const SCORE_HEX: Record<string, string> = {
  "text-green-500":  "#10b981",
  "text-yellow-500": "#eab308",
  "text-orange-500": "#f97316",
  "text-red-500":    "#ef4444",
};

const SCORE_TINT: Record<string, string> = {
  "text-green-500":  "from-emerald-400/[0.07] dark:from-emerald-500/[0.08]",
  "text-yellow-500": "from-amber-400/[0.05] dark:from-amber-500/[0.06]",
  "text-orange-500": "from-orange-400/[0.06] dark:from-orange-500/[0.07]",
  "text-red-500":    "from-red-400/[0.07] dark:from-red-500/[0.08]",
};

// ── Shared layout primitives ──────────────────────────────────────────────────

/** Standard card container shared by every section in InsightsContent. */
function SectionCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-[#13131f] rounded-2xl border border-slate-200 dark:border-indigo-900/40 p-5 ${className}`}>
      {children}
    </div>
  );
}

/** Icon + heading row at the top of every SectionCard. */
function SectionHeader({
  icon: Icon,
  title,
  children,
  iconBg = "bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50",
  iconColor = "text-indigo-500 dark:text-indigo-400",
  className = "mb-4",
}: {
  icon: ElementType;
  title: ReactNode;
  children?: ReactNode;
  iconBg?: string;
  iconColor?: string;
  /** Tailwind margin-bottom class applied to the row. Defaults to "mb-4". */
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
        <Icon size={13} className={iconColor} aria-hidden="true" />
      </div>
      <h3 className="font-semibold text-slate-900 dark:text-white">
        {title}
        {children}
      </h3>
    </div>
  );
}

// ── ScoreGauge ────────────────────────────────────────────────────────────────

function ScoreGauge({
  score,
  label,
  icon: Icon,
  iconBg,
  iconColor,
  low,
  high,
  colorFn,
  invertGradient = false,
}: {
  score: number | null;
  label: string;
  icon?: ElementType;
  iconBg?: string;
  iconColor?: string;
  low: string;
  high: string;
  colorFn: (v: number) => string;
  invertGradient?: boolean;
}) {
  if (score === null) {
    return (
      <div className="rounded-2xl bg-slate-50 dark:bg-[#0c0c18] border border-slate-100 dark:border-indigo-900/30 p-4">
        <div className="flex items-center gap-2.5 mb-3">
          {Icon && (
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
              <Icon size={13} className={iconColor} aria-hidden="true" />
            </div>
          )}
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</span>
        </div>
        <div className="h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 mb-2" />
        <span className="text-[10px] text-slate-400 italic">Not enough data</span>
      </div>
    );
  }

  const pct        = Math.min(Math.max(score, 0), 100);
  const colorClass = colorFn(score);
  const markerHex  = SCORE_HEX[colorClass] ?? "#eab308";
  const tintFrom   = SCORE_TINT[colorClass] ?? "from-amber-400/[0.05] dark:from-amber-500/[0.06]";
  const gradientClass = invertGradient
    ? "bg-gradient-to-r from-green-400 via-yellow-400 to-red-400"
    : "bg-gradient-to-r from-red-400 via-yellow-400 to-green-400";

  return (
    <div className={`rounded-2xl border border-slate-100 dark:border-indigo-900/30 p-4 bg-gradient-to-br ${tintFrom} to-white dark:to-[#0c0c18]`}>
      <div className="flex items-center gap-2 mb-3">
        {Icon && (
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
            <Icon size={13} className={iconColor} aria-hidden="true" />
          </div>
        )}
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 leading-tight flex-1">{label}</span>
        <span className={`text-3xl font-black tabular-nums leading-none ${colorClass}`}>{score}</span>
      </div>

      <div className="relative mb-2.5 py-[3px]" role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="relative h-2.5 rounded-full overflow-hidden bg-slate-200/60 dark:bg-slate-700/50">
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${gradientClass} transition-all duration-700`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div
          className="absolute top-1/2 -translate-y-1/2 w-[14px] h-[14px] rounded-full bg-white z-10 transition-all duration-700"
          style={{
            left: `calc(${pct}% - 7px)`,
            boxShadow: `0 0 0 2.5px ${markerHex}, 0 2px 6px rgba(0,0,0,0.12)`,
          }}
        />
      </div>

      <div className="flex justify-between">
        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">{low}</span>
        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">{high}</span>
      </div>
    </div>
  );
}

// ── RelationshipScore mini-gauge ──────────────────────────────────────────────

function RelationshipScore({ score }: { score: number | null }) {
  const { t } = useI18n();
  if (score === null) {
    return <span className="text-[10px] text-gray-400 italic">{t("insights_insufficient_data")}</span>;
  }
  const colorClass = score > 65 ? "bg-green-500" : score > 35 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 shrink-0">{score}</span>
    </div>
  );
}

// ── ReliabilityCallout ────────────────────────────────────────────────────────

function ReliabilityCallout({ reliability }: { reliability: AnalyticsSummary["data_reliability"] }) {
  const { t } = useI18n();
  const labelMap: Record<string, string> = {
    insufficient: t("reliability_insufficient"),
    low:          t("reliability_low"),
    moderate:     t("reliability_moderate"),
    high:         t("reliability_high"),
  };
  const descMap: Record<string, string> = {
    insufficient: t("reliability_desc_insufficient"),
    low:          t("reliability_desc_low"),
    moderate:     t("reliability_desc_moderate"),
    high:         t("reliability_desc_high"),
  };
  const signalLevel = RELIABILITY_SIGNAL[reliability] ?? 1;
  return (
    <div className={`relative flex items-center gap-3.5 rounded-xl p-3.5 mb-6 border ${RELIABILITY_CONTAINER[reliability]}`}>
      <div className="flex items-end gap-[3px] shrink-0" aria-hidden="true">
        {[1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={`w-[3px] rounded-sm transition-all ${level <= signalLevel ? RELIABILITY_BAR_COLOR[reliability] : "bg-slate-200 dark:bg-slate-700"}`}
            style={{ height: `${level * 5 + 3}px` }}
          />
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-bold leading-none mb-1 ${RELIABILITY_TEXT_COLOR[reliability]}`}>
          {labelMap[reliability]}
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {descMap[reliability]}
        </p>
      </div>
    </div>
  );
}

// ── CognitiveNoiseWidget ──────────────────────────────────────────────────────

const NOISE_HEIGHTS = [3, 5, 4, 7, 6, 9, 7, 5, 8, 6, 4, 7] as const;

function CognitiveNoiseWidget({ noise }: { noise: NonNullable<AnalyticsSummary["cognitive_noise"]> }) {
  const { t } = useI18n();
  const noiseDescMap: Record<string, string> = {
    high:     t("cognitive_noise_high"),
    moderate: t("cognitive_noise_moderate"),
    low:      t("cognitive_noise_low"),
  };
  const litCount = COGNITIVE_NOISE_LIT[noise] ?? 4;
  return (
    <div className="relative rounded-xl bg-slate-50 dark:bg-[#0c0c18] border border-slate-100 dark:border-indigo-900/30 px-4 py-3.5">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              {t("cognitive_noise_label")}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${COGNITIVE_NOISE_BADGE[noise]}`}>
              {noise}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-snug">
            {noiseDescMap[noise]}
          </p>
        </div>
        <div className="flex items-end gap-[2px] shrink-0" aria-hidden="true">
          {NOISE_HEIGHTS.map((h, i) => (
            <div
              key={i}
              className={`w-[2.5px] rounded-sm transition-all ${COGNITIVE_NOISE_BAR_COLOR[noise]} ${i < litCount ? "opacity-90" : "opacity-15"}`}
              style={{ height: `${h * 2}px` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Mock data — blurred behind the upgrade gate ───────────────────────────────

const MOCK_DATA: AnalyticsSummary = {
  total_sessions: 7,
  total_messages: 63,
  data_reliability: "moderate",
  confidence_score: 58,
  anxiety_score: 72,
  self_esteem_score: 44,
  ego_score: 68,
  emotion_control_score: 41,
  self_awareness_score: 55,
  motivation_score: 39,
  stress_load: 81,
  cognitive_noise: "high",
  logic_loops: [
    { topic: "Work performance anxiety", frequency: 11, efficiency: 28, fix_type: "Cognitive reframe" },
    { topic: "Relationship uncertainty", frequency: 7,  efficiency: 41, fix_type: "Values clarification" },
  ],
  insights: [
    { category: "Self-worth", observation: "You frequently tie your value to external achievement milestones.", trend: "stable" },
    { category: "Stress",     observation: "Deadline pressure consistently triggers avoidance behaviours.",    trend: "declining" },
  ],
  recommendations: [
    { type: "practice", title: "5-4-3-2-1 Grounding",      description: "Use before high-stakes moments to interrupt anticipatory anxiety.", why: "Your anxiety score peaks before external evaluations." },
    { type: "strategy", title: "Weekly values check-in", description: "Spend 5 minutes each Sunday reconnecting with your top 3 values.",       why: "Your self-esteem responds well to intrinsic anchors." },
  ],
  focus_areas: ["Confidence", "Stress regulation", "Self-compassion", "Boundaries"],
  relational_observations: [
    { person: "Partner", quality: "Supportive", evidence: "Described as 'the one person who gets it'", suggested_action: "Schedule low-pressure connection rituals weekly.", relationship_score: 78 },
    { person: "Manager", quality: "Tense",      evidence: "Mentioned with anxiety markers 9 times",   suggested_action: "Clarify expectations via a structured 1-on-1.",       relationship_score: 31 },
  ],
  social_gratitude_index: 54,
  priority_stack: [
    { rank: 1, category: "Health",  action: "Re-establish a sleep anchor time",                        reasoning: "Sleep disruption is compounding your stress load.",             urgency: "high" },
    { rank: 2, category: "Career",  action: "Draft a 'done is better than perfect' rule for yourself", reasoning: "Perfectionism is the root of your recurring avoidance loop.", urgency: "medium" },
  ],
  generated_at: new Date().toISOString(),
};

// ── Page component ────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const { getToken } = useAuth();
  const { t } = useI18n();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [history, setHistory] = useState<ScoreHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    setData(null);
    setHistory(null);
    setSubscriptionRequired(false);
    let cancelled = false;
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const summary = await api.getAnalytics(token, force);
      if (!cancelled) setData(summary);
      // History is best-effort — failure must not block the main summary.
      // Guard against state updates after unmount or a subsequent load() call.
      api.getScoreHistory(token)
        .then(h => { if (!cancelled) setHistory(h); })
        .catch(() => null);
    } catch (err: unknown) {
      if (cancelled) return;
      const subErr = (err as { subscriptionError?: SubscriptionError }).subscriptionError;
      if (subErr) {
        setSubscriptionRequired(true);
      } else {
        setError("Failed to load insights. Make sure you have at least one coaching session.");
      }
    } finally {
      if (!cancelled) setLoading(false);
    }
    return () => { cancelled = true; };
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="h-full min-h-screen bg-slate-50 dark:bg-[#080810] overflow-y-auto p-0">
      <div className="max-w-6xl mx-auto px-6 pt-10 pb-8">

        {/* ── Page header ── */}
        <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-[#0c0c18] shadow-xl mb-8 border border-indigo-900/40">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute top-0 left-0 w-28 h-full bg-gradient-to-r from-indigo-600/[0.07] to-transparent" />
            <div className="absolute -top-2 left-8 w-16 h-8 rounded-full bg-indigo-500/10 blur-2xl" />
          </div>
          <div className="flex items-center gap-4 px-8 pt-7 pb-5 relative z-10">
            <div className="relative shrink-0">
              <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-indigo-500/35 to-violet-600/35 blur-lg" />
              <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-900/30 ring-1 ring-white/[0.12]">
                <Brain size={22} className="text-white" aria-hidden="true" />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 bg-clip-text text-transparent tracking-tight">{t("insights_your_insights")}</h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t("insights_page_subtitle")}</p>
            </div>
            <div className="flex-1" />
            <button
              onClick={() => load(true)}
              disabled={loading}
              aria-label="Refresh insights"
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold shadow-md ring-1 ring-white/[0.10] hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden="true" />
              {t("insights_refresh")}
            </button>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 dark:via-indigo-500/30 to-transparent" />
        </div>

        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 mb-6 text-center">
          {t("insights_analysis_note")}
        </p>

        {/* ── Loading ── */}
        {loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-400 dark:text-slate-600" aria-live="polite" aria-busy="true">
            <Loader2 size={28} className="animate-spin" aria-hidden="true" />
            <p className="text-sm">{t("insights_analysing")}</p>
          </div>
        )}

        {/* ── Error ── */}
        {error && !loading && (
          <div role="alert" className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* ── Upgrade gate: blurred mock + overlay ── */}
        {subscriptionRequired && !loading && (
          <div className="relative">
            <div className="pointer-events-none select-none blur-sm opacity-60" aria-hidden="true">
              <InsightsContent data={MOCK_DATA} history={null} />
            </div>
            <div className="absolute inset-0 flex items-start justify-center pt-16 z-10">
              <div className="mx-4 w-full max-w-md bg-white dark:bg-[#13131f] rounded-2xl border border-indigo-100 dark:border-indigo-800/50 shadow-2xl shadow-indigo-900/10 dark:shadow-indigo-900/60 p-7 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30">
                  <Lock size={24} className="text-white" aria-hidden="true" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{t("insights_unlock_title")}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1 leading-relaxed">
                  {t("insights_unlock_body")}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">{t("insights_unlock_note")}</p>
                <Link
                  href="/pricing"
                  className="flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30 mb-3"
                >
                  <Zap size={15} aria-hidden="true" />
                  {t("insights_upgrade_cta")}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
                <p className="text-[11px] text-slate-400">{t("insights_upgrade_stripe")}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Real data ── */}
        {data && !loading && (
          <InsightsContent data={data} history={history} />
        )}

      </div>
    </div>
  );
}

// ── Score history chart ───────────────────────────────────────────────────────

function ScoreHistoryChart({ history }: { history: ScoreHistory | null }) {
  const { t } = useI18n();
  // Chart line definitions — labels translated, keys/colours static.
  const chartLines = [
    { key: "confidence",      label: t("score_confidence"),      color: "#6366f1" },
    { key: "stress",          label: t("score_stress"),          color: "#f97316" },
    { key: "anxiety",         label: t("score_anxiety"),         color: "#ef4444" },
    { key: "self_esteem",     label: t("score_self_esteem"),     color: "#10b981" },
    { key: "ego",             label: t("score_ego"),             color: "#a855f7" },
    { key: "emotion_control", label: t("score_emotion_control"), color: "#06b6d4" },
    { key: "social",          label: t("score_social_health"),   color: "#f43f5e" },
    { key: "self_awareness",  label: t("score_self_awareness"),  color: "#0ea5e9" },
    { key: "motivation",      label: t("score_motivation"),      color: "#f59e0b" },
  ] as const;
  // Deduplicate to one point per LOCAL calendar day (latest entry wins).
  // Must run in the browser — only the client knows the user's timezone.
  const chartPoints: ScorePoint[] = history?.points.length
    ? deduplicateScorePoints(history.points)
    : [];

  const hasData = chartPoints.length >= 2;

  return (
    <SectionCard>
      <SectionHeader icon={TrendingUp} title={t("insights_score_trends")} className="mb-1" />
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
        {t("insights_trends_subtitle")}
        {hasData && <span className="ml-1 text-slate-300 dark:text-slate-600">· {chartPoints.length} snapshots</span>}
      </p>
      {hasData ? (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartPoints} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-100 dark:text-indigo-900/40" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "currentColor" }}
              className="text-gray-400"
              tickLine={false}
              axisLine={false}
              tickFormatter={(d: string) => new Date(d).toLocaleDateString([], { month: "short", day: "numeric" })}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: "currentColor" }}
              className="text-gray-400"
              tickLine={false}
              axisLine={false}
              ticks={[0, 25, 50, 75, 100]}
            />
            <Tooltip
              contentStyle={{
                background: "var(--tooltip-bg, #fff)",
                border: "1px solid #e0e7ff",
                borderRadius: "0.75rem",
                fontSize: "11px",
                boxShadow: "0 4px 24px rgba(99,102,241,0.10)",
              }}
              itemStyle={{ padding: "1px 0" }}
              labelFormatter={(d: string) => new Date(d).toLocaleDateString([], { month: "short", day: "numeric" })}
              formatter={(value: number, name: string) => [value, name]}
            />
            <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }} />
            {chartLines.map(({ key, label, color }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={color}
                strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0, fill: color }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-32 rounded-xl bg-slate-50 dark:bg-[#0c0c18] border border-slate-100 dark:border-indigo-900/30">
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">
            {t("insights_trends_empty")}
          </p>
        </div>
      )}
    </SectionCard>
  );
}

// ── InsightsContent (pure render) ─────────────────────────────────────────────

function InsightsContent({ data, history }: { data: AnalyticsSummary; history: ScoreHistory | null }) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">

      {/* ── At a glance ── */}
      <div>
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 mb-4">{t("insights_at_a_glance")}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Brain,         label: t("insights_coaching_sessions"),  value: data.total_sessions },
            { icon: MessageCircle, label: t("insights_messages_analysed"),  value: data.total_messages },
            { icon: Activity,      label: t("insights_focus_areas_count"),        value: data.focus_areas.length },
            { icon: AlertTriangle, label: t("insights_recurring_patterns"), value: data.logic_loops.length },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="bg-white dark:bg-[#13131f] rounded-2xl border border-slate-200 dark:border-indigo-900/40 p-5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50 mb-3">
                <Icon size={16} className="text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
              </div>
              <p className="text-3xl font-bold bg-gradient-to-r from-indigo-500 to-violet-600 bg-clip-text text-transparent">{value}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">

        {/* ===== LEFT COLUMN ===== */}
        <div className="space-y-5">

          <ScoreHistoryChart history={history} />

          {/* Psychological Profile — unique card with ambient depth + overflow-hidden */}
          <div className="relative bg-white dark:bg-[#13131f] rounded-2xl border border-slate-200 dark:border-indigo-900/40 p-6 overflow-hidden">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute top-0 left-0 w-32 h-full bg-gradient-to-r from-indigo-600/[0.05] to-transparent" />
              <div className="absolute top-0 right-0 w-24 h-full bg-gradient-to-l from-violet-600/[0.03] to-transparent" />
            </div>

            <div className="flex items-center gap-2.5 mb-1 relative">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50 shrink-0">
                <Activity size={13} className="text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-white">{t("insights_psychological_profile")}</h3>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-5 relative">
              {t("insights_profile_note")}
            </p>

            <ReliabilityCallout reliability={data.data_reliability} />

            <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-600 mb-3 relative">{t("insights_self_perception")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5 relative">
              <ScoreGauge
                score={data.confidence_score}
                label={t("score_confidence")}
                icon={Zap}
                iconBg="bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50"
                iconColor="text-indigo-500 dark:text-indigo-400"
                low={t("score_confidence_low")}
                high={t("score_confidence_high")}
                colorFn={(v) => v > 65 ? "text-green-500" : v > 35 ? "text-yellow-500" : "text-red-500"}
              />
              <ScoreGauge
                score={data.self_esteem_score}
                label={t("score_self_esteem")}
                icon={Star}
                iconBg="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-800/50"
                iconColor="text-emerald-500 dark:text-emerald-400"
                low={t("score_esteem_low")}
                high={t("score_esteem_high")}
                colorFn={(v) => v > 65 ? "text-green-500" : v > 35 ? "text-yellow-500" : "text-red-500"}
              />
              <ScoreGauge
                score={data.ego_score}
                label={t("score_ego")}
                icon={Shield}
                iconBg="bg-purple-50 dark:bg-purple-950/60 border border-purple-100 dark:border-purple-800/50"
                iconColor="text-purple-500 dark:text-purple-400"
                low={t("score_ego_low")}
                high={t("score_ego_high")}
                colorFn={(v) => v > 70 ? "text-red-500" : v > 40 ? "text-orange-500" : "text-green-500"}
                invertGradient
              />
            </div>

            <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-600 mb-3 relative">{t("insights_regulation")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5 relative">
              <ScoreGauge
                score={data.anxiety_score}
                label={t("score_anxiety")}
                icon={AlertTriangle}
                iconBg="bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/40"
                iconColor="text-red-500 dark:text-red-400"
                low={t("score_anxiety_low")}
                high={t("score_anxiety_high")}
                colorFn={(v) => v > 70 ? "text-red-500" : v > 40 ? "text-orange-500" : "text-green-500"}
                invertGradient
              />
              <ScoreGauge
                score={data.stress_load}
                label={t("score_stress_load")}
                icon={Flame}
                iconBg="bg-orange-50 dark:bg-orange-950/60 border border-orange-100 dark:border-orange-900/40"
                iconColor="text-orange-500 dark:text-orange-400"
                low={t("score_stress_low")}
                high={t("score_stress_high")}
                colorFn={(v) => v > 70 ? "text-red-500" : v > 40 ? "text-orange-500" : "text-green-500"}
                invertGradient
              />
              <ScoreGauge
                score={data.emotion_control_score}
                label={t("score_emotion_control")}
                icon={Activity}
                iconBg="bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-100 dark:border-cyan-800/50"
                iconColor="text-cyan-500 dark:text-cyan-400"
                low={t("score_control_low")}
                high={t("score_control_high")}
                colorFn={(v) => v > 65 ? "text-green-500" : v > 35 ? "text-yellow-500" : "text-red-500"}
              />
            </div>

            <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-600 mb-3 relative">{t("insights_growth")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 relative">
              <ScoreGauge
                score={data.self_awareness_score}
                label={t("score_self_awareness")}
                icon={Eye}
                iconBg="bg-sky-50 dark:bg-sky-950/60 border border-sky-100 dark:border-sky-800/50"
                iconColor="text-sky-500 dark:text-sky-400"
                low={t("score_awareness_low")}
                high={t("score_awareness_high")}
                colorFn={(v) => v > 65 ? "text-green-500" : v > 35 ? "text-yellow-500" : "text-red-500"}
              />
              <ScoreGauge
                score={data.motivation_score}
                label={t("score_motivation")}
                icon={Target}
                iconBg="bg-amber-50 dark:bg-amber-950/60 border border-amber-100 dark:border-amber-800/50"
                iconColor="text-amber-500 dark:text-amber-400"
                low={t("score_motivation_low")}
                high={t("score_motivation_high")}
                colorFn={(v) => v > 65 ? "text-green-500" : v > 35 ? "text-yellow-500" : "text-red-500"}
              />
            </div>

            {data.cognitive_noise != null && (
              <CognitiveNoiseWidget noise={data.cognitive_noise} />
            )}
          </div>

          {/* Logic Loops */}
          {data.logic_loops.length > 0 && (
            <SectionCard>
              <SectionHeader
                icon={AlertTriangle}
                iconBg="bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/40"
                iconColor="text-red-500"
                title={t("insights_logic_loops")}
                className="mb-1"
              >
                <span className="ml-2 text-xs font-normal text-slate-400">({data.logic_loops.length})</span>
              </SectionHeader>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">{t("insights_logic_loops_desc")}</p>
              <div className="space-y-3">
                {data.logic_loops.map((loop, i) => (
                  <div key={i} className="border border-dashed border-red-300 dark:border-red-800/60 rounded-xl p-3 bg-red-50/50 dark:bg-red-950/20">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">{loop.topic}</span>
                      <span className="text-[10px] text-slate-400">~{loop.frequency} {t("insights_mentions")}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider text-[10px]">{t("insights_efficiency")}</span>
                      <span className={`font-bold ${loop.efficiency < 40 ? "text-red-500" : loop.efficiency < 65 ? "text-yellow-500" : "text-green-500"}`}>
                        {loop.efficiency}%
                      </span>
                      <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider text-[10px]">{t("insights_suggested_fix")}</span>
                      <span className="font-semibold text-indigo-600 dark:text-indigo-400">{loop.fix_type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Observations */}
          {data.insights.length > 0 && (
            <SectionCard>
              <SectionHeader icon={BookOpen} title={t("insights_observations")} />
              <div className="space-y-4">
                {data.insights.map((insight, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-indigo-400 mt-2 shrink-0" aria-hidden="true" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          {insight.category}
                        </span>
                        {insight.trend && (
                          <span className={`flex items-center gap-1 text-xs font-medium ${TREND_COLOR[insight.trend] ?? "text-slate-500"}`}>
                            {TREND_ICON[insight.trend]}
                            {insight.trend}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">{insight.observation}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

        </div>{/* end left column */}

        {/* ===== RIGHT COLUMN ===== */}
        <div className="space-y-5">

          {/* Priority Stack */}
          {data.priority_stack.length > 0 && (
            <SectionCard>
              <SectionHeader icon={Zap} title={t("insights_priority_stack")} />
              <div className="space-y-3">
                {data.priority_stack.map((item) => (
                  <div key={item.rank} className="flex gap-3 p-3 bg-slate-50 dark:bg-[#0c0c18] rounded-xl border border-slate-100 dark:border-indigo-900/30">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-xs font-bold flex items-center justify-center shrink-0 shadow-sm" aria-hidden="true">
                      {item.rank}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                          {CATEGORY_ICON[item.category] ?? <Star size={14} aria-hidden="true" />}
                          {item.category}
                        </span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${URGENCY_STYLES[item.urgency] ?? URGENCY_STYLES.low}`}>
                          {item.urgency}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white mt-0.5">{item.action}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 italic">{item.reasoning}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Relational Capital */}
          {(data.relational_observations.length > 0 || data.social_gratitude_index != null) && (
            <SectionCard>
              <SectionHeader icon={Users} title={t("insights_relational_capital")} className="mb-1" />
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
                {t("insights_relational_desc")}
              </p>
              {data.social_gratitude_index != null && (
                <div className="mb-5">
                  <ScoreGauge
                    score={data.social_gratitude_index}
                    label={t("score_overall_social_health")}
                    low={t("score_social_low")}
                    high={t("score_social_high")}
                    colorFn={(v) => v > 65 ? "text-green-500" : v > 35 ? "text-yellow-500" : "text-red-500"}
                  />
                </div>
              )}
              {data.relational_observations.length > 0 && (
                <div className="space-y-3">
                  {data.relational_observations.map((obs, i) => (
                    <div key={i} className="p-3 bg-slate-50 dark:bg-[#0c0c18] rounded-xl border border-slate-100 dark:border-indigo-900/30">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Heart size={13} className="text-rose-400 shrink-0" aria-hidden="true" />
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 capitalize">{obs.person}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          obs.relationship_score == null
                            ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                            : obs.relationship_score > 65
                              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                              : obs.relationship_score > 35
                                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
                                : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                        }`}>{obs.quality}</span>
                      </div>
                      <RelationshipScore score={obs.relationship_score} />
                      <p className="text-xs text-slate-500 dark:text-slate-400 italic mt-2">"{obs.evidence}"</p>
                      <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">→ {obs.suggested_action}</p>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          )}

          {/* Recommendations */}
          {data.recommendations.length > 0 && (
            <SectionCard>
              <SectionHeader icon={Star} title={t("insights_recommendations")} />
              <div className="space-y-3">
                {data.recommendations.map((rec, i) => (
                  <div key={i} className="flex gap-3 p-3 bg-slate-50 dark:bg-[#0c0c18] rounded-xl border border-slate-100 dark:border-indigo-900/30">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/50 shrink-0 mt-0.5" aria-hidden="true">
                      <span className="text-indigo-600 dark:text-indigo-400">
                        {TYPE_ICON[rec.type] ?? <Brain size={13} />}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{rec.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{rec.description}</p>
                      <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1 italic">{rec.why}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Focus Areas */}
          {data.focus_areas.length > 0 && (
            <SectionCard>
              <SectionHeader icon={BarChart2} title={t("insights_focus_areas")} className="mb-3" />
              <div className="flex flex-wrap gap-2">
                {data.focus_areas.map((area) => (
                  <span
                    key={area}
                    className="px-3 py-1 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-800/40 rounded-full text-sm font-medium"
                  >
                    {area}
                  </span>
                ))}
              </div>
            </SectionCard>
          )}

          {data.insights.length === 0 && data.recommendations.length === 0 && (
            <p className="text-center text-gray-400 dark:text-gray-600 py-12 text-sm">
              {t("insights_no_data")}
            </p>
          )}

        </div>{/* end right column */}
      </div>{/* end two-column grid */}

      <p className="text-xs text-slate-400 dark:text-slate-600 text-center pb-4">
        Generated {new Date(data.generated_at).toLocaleString()} · {t("insights_generated_suffix")}
      </p>
    </div>
  );
}
