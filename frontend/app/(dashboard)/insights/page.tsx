// frontend/app/(dashboard)/insights/page.tsx
"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import {
  BarChart2,
  BookOpen,
  Brain,
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
import { api, type AnalyticsSummary, type ScoreHistory, type SubscriptionError } from "@/lib/api";

const TREND_ICON: Record<string, ReactNode> = {
  improving: <TrendingUp size={13} className="text-green-500" />,
  declining: <TrendingDown size={13} className="text-red-500" />,
  stable: <Minus size={13} className="text-gray-400" />,
};

const TREND_COLOR: Record<string, string> = {
  improving: "text-green-500 dark:text-green-400",
  declining: "text-red-500 dark:text-red-400",
  stable: "text-gray-400",
};

const TYPE_ICON: Record<string, ReactNode> = {
  book: <BookOpen size={15} />,
  course: <BarChart2 size={15} />,
  practice: <Brain size={15} />,
  strategy: <Zap size={15} />,
};

const URGENCY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  low: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const CATEGORY_ICON: Record<string, ReactNode> = {
  Regulation: <Brain size={14} />,
  Relational: <Users size={14} />,
  Growth: <TrendingUp size={14} />,
  Career: <BarChart2 size={14} />,
  Health: <Heart size={14} />,
};

const RELIABILITY_LABEL: Record<string, string> = {
  insufficient: "Not enough data yet",
  low: "Early estimate",
  moderate: "Moderate confidence",
  high: "High confidence",
};

const RELIABILITY_DESC: Record<string, string> = {
  insufficient: "Send a few more messages so we can start building your profile.",
  low: "Based on fewer than 15 messages — scores are directional but will sharpen as we learn more about your patterns.",
  moderate: "Based on 15–30 messages. Scores are reasonably reliable and should reflect your general tendencies.",
  high: "Based on 30+ messages. These scores are well-established and highly consistent.",
};

const RELIABILITY_STYLE: Record<string, string> = {
  insufficient: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  low: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  moderate: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  high: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

/** A score gauge with endpoint descriptions and reliability badge */
function ScoreGauge({
  score,
  label,
  low,
  high,
  lowDesc,
  highDesc,
  colorFn,
  reliability,
  invertGradient = false,
}: {
  score: number | null;
  label: string;
  low: string;
  high: string;
  lowDesc: string;
  highDesc: string;
  colorFn: (v: number) => string;
  reliability: string;
  invertGradient?: boolean;
}) {
  if (score === null) {
    return (
      <div className="rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{label}</span>
          <span className="text-xs text-gray-400 italic">Not enough data</span>
        </div>
        <div className="h-2.5 rounded-full bg-gray-200 dark:bg-gray-700" />
      </div>
    );
  }

  const pct = Math.min(Math.max(score, 0), 100);
  const colorClass = colorFn(score);

  // Gradient track: full-width spectrum, right portion masked to reveal filled section.
  // invertGradient=true for "higher is worse" metrics (Stress, Anxiety).
  const gradientClass = invertGradient
    ? "bg-gradient-to-r from-green-400 via-yellow-400 to-red-400"
    : "bg-gradient-to-r from-red-400 via-yellow-400 to-green-400";

  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 p-4">
      {/* Header: label + score number */}
      <div className="flex items-start justify-between mb-3">
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{label}</span>
        <span className={`text-2xl font-black tabular-nums leading-none ${colorClass}`}>{score}</span>
      </div>

      {/* Gradient progress bar — mask right side to show fill position */}
      <div className="relative h-2.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mb-2.5">
        <div className={`absolute inset-0 ${gradientClass}`} />
        <div
          className="absolute top-0 right-0 h-full bg-gray-200 dark:bg-gray-700 transition-all duration-700"
          style={{ width: `${100 - pct}%` }}
        />
      </div>

      {/* Low label · reliability badge · high label */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{low}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${RELIABILITY_STYLE[reliability]}`}>
          {RELIABILITY_LABEL[reliability]}
        </span>
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{high}</span>
      </div>

      {/* Endpoint descriptions */}
      <div className="flex justify-between gap-4">
        <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-snug max-w-[46%]">{lowDesc}</p>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-snug max-w-[46%] text-right">{highDesc}</p>
      </div>
    </div>
  );
}

/** Relationship score mini-gauge */
function RelationshipScore({ score, reliability }: { score: number | null; reliability: string }) {
  if (score === null) {
    return <span className="text-[10px] text-gray-400 italic">Insufficient data</span>;
  }
  const colorClass = score > 65 ? "bg-green-500" : score > 35 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[11px] font-bold text-gray-600 dark:text-gray-400 shrink-0">{score}</span>
    </div>
  );
}

/** Realistic-looking placeholder data shown blurred behind the upgrade gate */
const MOCK_DATA: AnalyticsSummary = {
  total_sessions: 7,
  total_messages: 63,
  data_reliability: "moderate",
  confidence_score: 58,
  anxiety_score: 72,
  self_esteem_score: 44,
  stress_load: 81,
  cognitive_noise: "high",
  logic_loops: [
    { topic: "Work performance anxiety", frequency: 11, efficiency: 28, fix_type: "Cognitive reframe" },
    { topic: "Relationship uncertainty", frequency: 7, efficiency: 41, fix_type: "Values clarification" },
  ],
  insights: [
    { category: "Self-worth", observation: "You frequently tie your value to external achievement milestones.", trend: "stable" },
    { category: "Stress", observation: "Deadline pressure consistently triggers avoidance behaviours.", trend: "declining" },
  ],
  recommendations: [
    { type: "practice", title: "5-4-3-2-1 Grounding", description: "Use before high-stakes moments to interrupt anticipatory anxiety.", why: "Your anxiety score peaks before external evaluations." },
    { type: "strategy", title: "Weekly values check-in", description: "Spend 5 minutes each Sunday reconnecting with your top 3 values.", why: "Your self-esteem responds well to intrinsic anchors." },
  ],
  focus_areas: ["Confidence", "Stress regulation", "Self-compassion", "Boundaries"],
  relational_observations: [
    { person: "Partner", quality: "Supportive", evidence: "Described as 'the one person who gets it'", suggested_action: "Schedule low-pressure connection rituals weekly.", relationship_score: 78 },
    { person: "Manager", quality: "Tense", evidence: "Mentioned with anxiety markers 9 times", suggested_action: "Clarify expectations via a structured 1-on-1.", relationship_score: 31 },
  ],
  social_gratitude_index: 54,
  priority_stack: [
    { rank: 1, category: "Health", action: "Re-establish a sleep anchor time", reasoning: "Sleep disruption is compounding your stress load.", urgency: "high" },
    { rank: 2, category: "Career", action: "Draft a 'done is better than perfect' rule for yourself", reasoning: "Perfectionism is the root of your recurring avoidance loop.", urgency: "medium" },
  ],
  generated_at: new Date().toISOString(),
};

export default function InsightsPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [history, setHistory] = useState<ScoreHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSubscriptionRequired(false);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      // Fetch summary first; history is best-effort (non-blocking)
      const summary = await api.getAnalytics(token);
      setData(summary);
      api.getScoreHistory(token).then(setHistory).catch(() => null);
    } catch (err: unknown) {
      const subErr = (err as { subscriptionError?: SubscriptionError }).subscriptionError;
      if (subErr) {
        setSubscriptionRequired(true);
      } else {
        setError("Failed to load insights. Make sure you have at least one coaching session.");
      }
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  // Resolve what data to render: real data, or mock backdrop for glassdoor effect
  const displayData = data ?? (subscriptionRequired ? MOCK_DATA : null);

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Your Insights</h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Psychological diagnostics synthesised from all your coaching sessions
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-600 mb-6">
          Analysis is based on your entire conversation history. More sessions = higher confidence scores. Generation may take 15–30 seconds.
        </p>

        {loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-400 dark:text-gray-600">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-sm">Analysing all your conversation history…</p>
          </div>
        )}

        {error && !loading && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Glassdoor effect — blurred mock data + upgrade overlay */}
        {subscriptionRequired && !loading && (
          <div className="relative">
            {/* Blurred backdrop */}
            <div className="pointer-events-none select-none blur-sm opacity-60" aria-hidden="true">
              <InsightsContent data={MOCK_DATA} history={null} />
            </div>

            {/* Upgrade overlay */}
            <div className="absolute inset-0 flex items-start justify-center pt-16 z-10">
              <div className="mx-4 w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-gray-900/10 dark:shadow-gray-900/60 p-7 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-brand-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-200 dark:shadow-violet-900/30">
                  <Lock size={24} className="text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  Unlock your psychological profile
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1 leading-relaxed">
                  Your insights are ready — confidence score, stress load, logic loops, relational capital, and a personalised priority stack.
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
                  Pro plan · Unlimited sessions · Full insights dashboard
                </p>
                <Link
                  href="/pricing"
                  className="flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-brand-600 text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-lg shadow-violet-200 dark:shadow-violet-900/30 mb-3"
                >
                  <Zap size={15} />
                  Upgrade to Pro — from $8.25/mo
                  <ArrowUpRight size={14} />
                </Link>
                <p className="text-[11px] text-gray-400">
                  Secure payment via Stripe · Cancel anytime
                </p>
              </div>
            </div>
          </div>
        )}

        {displayData && !subscriptionRequired && !loading && (
          <InsightsContent data={displayData} history={history} />
        )}
      </div>
    </div>
  );
}

const CHART_LINES = [
  { key: "confidence",  label: "Confidence",  color: "#6366f1" },
  { key: "stress",      label: "Stress",       color: "#f97316" },
  { key: "anxiety",     label: "Anxiety",      color: "#ef4444" },
  { key: "self_esteem", label: "Self-Esteem",  color: "#10b981" },
] as const;

function ScoreHistoryChart({ history }: { history: ScoreHistory | null }) {
  if (!history || history.points.length < 2) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={16} className="text-brand-600 dark:text-brand-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Score Trends</h3>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
          How your psychological scores have shifted over time.
        </p>
        <div className="flex items-center justify-center h-32 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">
            Trends appear after your second insights generation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp size={16} className="text-brand-600 dark:text-brand-400" />
        <h3 className="font-semibold text-gray-900 dark:text-white">Score Trends</h3>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">
        How your psychological scores have shifted across {history.points.length} snapshots.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={history.points} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-100 dark:text-gray-800" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "currentColor" }}
            className="text-gray-400"
            tickLine={false}
            axisLine={false}
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
              border: "1px solid #e5e7eb",
              borderRadius: "0.5rem",
              fontSize: "11px",
            }}
            itemStyle={{ padding: "1px 0" }}
            formatter={(value: number, name: string) => [value, name]}
          />
          <Legend
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }}
          />
          {CHART_LINES.map(({ key, label, color }) => (
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
    </div>
  );
}

/** Pure render component — used for real data and the blurred mock backdrop */
function InsightsContent({ data, history }: { data: AnalyticsSummary; history: ScoreHistory | null }) {
  return (
    <div className="space-y-5">
            {/* — Stats Row (4 cols) — */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                <p className="text-3xl font-bold text-brand-600 dark:text-brand-400">{data.total_sessions}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Coaching sessions</p>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                <p className="text-3xl font-bold text-brand-600 dark:text-brand-400">{data.total_messages}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Messages analysed</p>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                <p className="text-3xl font-bold text-brand-600 dark:text-brand-400">{data.focus_areas.length}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Focus areas</p>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                <p className="text-3xl font-bold text-brand-600 dark:text-brand-400">{data.logic_loops.length}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Recurring patterns</p>
              </div>
            </div>

            {/* — Two-column body — */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">

              {/* ===== LEFT COLUMN ===== */}
              <div className="space-y-5">

                {/* — Score Trends chart — */}
                <ScoreHistoryChart history={history} />

                {/* — Psychological Profile — */}
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity size={16} className="text-brand-600 dark:text-brand-400" />
                    <h3 className="font-semibold text-gray-900 dark:text-white">Psychological Profile</h3>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                    Scores are inferred from language patterns across your sessions — not a clinical assessment.
                  </p>

                  {/* Reliability callout */}
                  <div className={`flex gap-3 rounded-lg p-3 mb-5 ${
                    data.data_reliability === "high" ? "bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800"
                    : data.data_reliability === "moderate" ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800"
                    : data.data_reliability === "low" ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800"
                    : "bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700"
                  }`}>
                    <span className={`text-xs font-bold shrink-0 pt-0.5 ${
                      data.data_reliability === "high" ? "text-green-600 dark:text-green-400"
                      : data.data_reliability === "moderate" ? "text-blue-600 dark:text-blue-400"
                      : data.data_reliability === "low" ? "text-amber-600 dark:text-amber-400"
                      : "text-gray-400"
                    }`}>
                      {RELIABILITY_LABEL[data.data_reliability]}
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                      {RELIABILITY_DESC[data.data_reliability]}
                    </p>
                  </div>

                  {/* 2×2 gauge grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <ScoreGauge
                      score={data.confidence_score}
                      label="Confidence"
                      low="Self-doubting"
                      high="Self-assured"
                      lowDesc="You tend to question your abilities and may attribute successes to luck or external factors."
                      highDesc="You trust your judgment, take initiative, and hold a stable belief in your own capabilities."
                      reliability={data.data_reliability}
                      colorFn={(v) => v > 65 ? "text-green-500" : v > 35 ? "text-yellow-500" : "text-red-500"}
                    />
                    <ScoreGauge
                      score={data.stress_load}
                      label="Stress Load"
                      low="Calm"
                      high="Overloaded"
                      lowDesc="Challenges feel manageable. You show few signs of being overwhelmed."
                      highDesc="You're carrying significant pressure — this may affect sleep, focus, and decision-making."
                      reliability={data.data_reliability}
                      colorFn={(v) => v > 70 ? "text-red-500" : v > 40 ? "text-orange-500" : "text-green-500"}
                      invertGradient
                    />
                    <ScoreGauge
                      score={data.anxiety_score}
                      label="Anxiety"
                      low="Settled"
                      high="Highly anxious"
                      lowDesc="You approach uncertainty with equanimity and rarely feel overwhelmed by worry."
                      highDesc="Persistent worry patterns are evident and may be affecting daily functioning."
                      reliability={data.data_reliability}
                      colorFn={(v) => v > 70 ? "text-red-500" : v > 40 ? "text-orange-500" : "text-green-500"}
                      invertGradient
                    />
                    <ScoreGauge
                      score={data.self_esteem_score}
                      label="Self-Esteem"
                      low="Low self-worth"
                      high="Strong self-worth"
                      lowDesc="You tend to be highly self-critical and may struggle to recognise your own value."
                      highDesc="You hold a stable, positive sense of your own worth independent of external outcomes."
                      reliability={data.data_reliability}
                      colorFn={(v) => v > 65 ? "text-green-500" : v > 35 ? "text-yellow-500" : "text-red-500"}
                    />
                  </div>

                  {data.cognitive_noise != null && (
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 p-4 mt-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">Cognitive Noise</p>
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-snug max-w-xs">
                            {data.cognitive_noise === "high"
                              ? "Significant mental clutter detected — racing thoughts or decision fatigue may be affecting focus and clarity."
                              : data.cognitive_noise === "moderate"
                              ? "Some mental clutter is present. You may notice occasional difficulty prioritising or staying on one train of thought."
                              : "Your thinking appears clear and focused across your sessions."}
                          </p>
                        </div>
                        <span
                          className={`text-xs font-bold px-2.5 py-1 rounded-md shrink-0 ml-3 ${
                            data.cognitive_noise === "high"
                              ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                              : data.cognitive_noise === "moderate"
                              ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
                              : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          }`}
                        >
                          {data.cognitive_noise}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* — Logic Loops — */}
                {data.logic_loops.length > 0 && (
                  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle size={16} className="text-red-500" />
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        Logic Loops Detected
                        <span className="ml-2 text-xs font-normal text-gray-400">({data.logic_loops.length})</span>
                      </h3>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                      Recurring thought patterns detected across your sessions.
                    </p>
                    <div className="space-y-3">
                      {data.logic_loops.map((loop, i) => (
                        <div
                          key={i}
                          className="border border-dashed border-red-300 dark:border-red-800 rounded-lg p-3 bg-red-50/50 dark:bg-red-950/20"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">
                              {loop.topic}
                            </span>
                            <span className="text-[10px] text-gray-400">~{loop.frequency} mentions</span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                            <span className="text-gray-400 dark:text-gray-500 uppercase tracking-wider text-[10px]">Efficiency</span>
                            <span className={`font-bold ${loop.efficiency < 40 ? "text-red-500" : loop.efficiency < 65 ? "text-yellow-500" : "text-green-500"}`}>
                              {loop.efficiency}%
                            </span>
                            <span className="text-gray-400 dark:text-gray-500 uppercase tracking-wider text-[10px]">Suggested Fix</span>
                            <span className="font-semibold text-brand-600 dark:text-brand-400">{loop.fix_type}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* — Observations — */}
                {data.insights.length > 0 && (
                  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Observations</h3>
                    <div className="space-y-4">
                      {data.insights.map((insight, i) => (
                        <div key={i} className="flex gap-3">
                          <div className="w-2 h-2 rounded-full bg-brand-400 mt-2 shrink-0" />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                                {insight.category}
                              </span>
                              {insight.trend && (
                                <span className={`flex items-center gap-1 text-xs font-medium ${TREND_COLOR[insight.trend] ?? "text-gray-500"}`}>
                                  {TREND_ICON[insight.trend]}
                                  {insight.trend}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{insight.observation}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>{/* end left column */}

              {/* ===== RIGHT COLUMN ===== */}
              <div className="space-y-5">

                {/* — Weekly Priority Stack — */}
                {data.priority_stack.length > 0 && (
                  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Zap size={16} className="text-brand-600 dark:text-brand-400" />
                      <h3 className="font-semibold text-gray-900 dark:text-white">Weekly Priority Stack</h3>
                    </div>
                    <div className="space-y-3">
                      {data.priority_stack.map((item) => (
                        <div key={item.rank} className="flex gap-3 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-lg">
                          <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400 text-xs font-bold flex items-center justify-center shrink-0">
                            {item.rank}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                {CATEGORY_ICON[item.category] ?? <Star size={14} />}
                                {item.category}
                              </span>
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${URGENCY_STYLES[item.urgency] ?? URGENCY_STYLES.low}`}>
                                {item.urgency}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">{item.action}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 italic">{item.reasoning}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* — Relational Capital — */}
                {(data.relational_observations.length > 0 || data.social_gratitude_index != null) && (
                  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                    <div className="flex items-center gap-2 mb-1">
                      <Users size={16} className="text-brand-600 dark:text-brand-400" />
                      <h3 className="font-semibold text-gray-900 dark:text-white">Relational Capital</h3>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                      Relationship quality inferred from how you describe people in your sessions.
                    </p>
                    {data.social_gratitude_index != null && (
                      <div className="mb-5">
                        <ScoreGauge
                          score={data.social_gratitude_index}
                          label="Overall Social Health"
                          low="Isolated"
                          high="Well-connected"
                          lowDesc="You mention few meaningful connections or describe relationships with distance or strain."
                          highDesc="You describe rich, supportive relationships and a sense of belonging in your life."
                          reliability={data.data_reliability}
                          colorFn={(v) => v > 65 ? "text-green-500" : v > 35 ? "text-yellow-500" : "text-red-500"}
                        />
                      </div>
                    )}
                    {data.relational_observations.length > 0 && (
                      <div className="space-y-3">
                        {data.relational_observations.map((obs, i) => (
                          <div key={i} className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded-lg">
                            <div className="flex items-center gap-2 mb-0.5">
                              <Heart size={13} className="text-rose-400 shrink-0" />
                              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 capitalize">{obs.person}</span>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-medium">{obs.quality}</span>
                            </div>
                            <RelationshipScore score={obs.relationship_score} reliability={data.data_reliability} />
                            <p className="text-xs text-gray-500 dark:text-gray-400 italic mt-2">"{obs.evidence}"</p>
                            <p className="text-xs text-brand-600 dark:text-brand-400 mt-1">→ {obs.suggested_action}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* — Recommendations — */}
                {data.recommendations.length > 0 && (
                  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Recommendations</h3>
                    <div className="space-y-3">
                      {data.recommendations.map((rec, i) => (
                        <div key={i} className="flex gap-3 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-lg">
                          <span className="text-brand-600 dark:text-brand-400 mt-0.5 shrink-0">
                            {TYPE_ICON[rec.type] ?? <Brain size={15} />}
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{rec.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{rec.description}</p>
                            <p className="text-xs text-brand-600 dark:text-brand-400 mt-1 italic">{rec.why}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* — Focus Areas — */}
                {data.focus_areas.length > 0 && (
                  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Focus Areas</h3>
                    <div className="flex flex-wrap gap-2">
                      {data.focus_areas.map((area) => (
                        <span
                          key={area}
                          className="px-3 py-1 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 rounded-full text-sm font-medium"
                        >
                          {area}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {data.insights.length === 0 && data.recommendations.length === 0 && (
                  <div className="text-center text-gray-400 dark:text-gray-600 py-12 text-sm">
                    Complete a few coaching sessions to generate personalised insights.
                  </div>
                )}

              </div>{/* end right column */}
            </div>{/* end two-column grid */}

            <p className="text-xs text-gray-400 dark:text-gray-600 text-center pb-4">
              Generated {new Date(data.generated_at).toLocaleString()} · AI observations only — not a clinical assessment
            </p>
    </div>
  );
}

