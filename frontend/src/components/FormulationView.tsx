import React from 'react';
import { BookOpen, CheckCircle2, Info, Sigma } from 'lucide-react';
import type { MathFormulationSection } from '../types/or';
import { MathBlock } from './MathBlock';

interface FormulationViewProps {
  formulation: MathFormulationSection;
}

export const FormulationView: React.FC<FormulationViewProps> = ({ formulation }) => {
  return (
    <div className="space-y-6">
      {/* 1. Problem Definition */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="mb-3 flex items-center gap-2.5">
          <BookOpen className="h-5 w-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-900">
            1. Problem Definition — {formulation.problem_title}
          </h3>
        </div>
        <p className="text-sm leading-relaxed text-slate-700">{formulation.problem_definition}</p>
      </section>

      {/* 2. Sets & Parameters */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
            2. Index Sets
          </h3>
          <div className="space-y-3">
            {formulation.sets.map((s, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3.5 py-2.5"
              >
                <div className="min-w-[44px] pt-0.5 text-slate-900">
                  <MathBlock latex={s.symbol} displayMode={false} />
                </div>
                <span className="text-sm text-slate-700">{s.description}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
            3. Model Parameters
          </h3>
          <div className="space-y-2.5">
            {formulation.parameters.map((p, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3.5 py-2.5"
              >
                <div className="min-w-[68px] pt-0.5 text-slate-900">
                  <MathBlock latex={p.symbol} displayMode={false} />
                </div>
                <span className="text-sm text-slate-700">{p.description}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Decision Variables */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
          4. Decision Variables
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {formulation.decision_variables.map((v, idx) => (
            <div
              key={idx}
              className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3"
            >
              <div className="min-w-[72px] text-slate-900">
                <MathBlock latex={v.symbol} displayMode={false} />
              </div>
              <span className="text-sm text-slate-700">{v.description}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Objective Function */}
      <section className="rounded-xl border border-blue-200 bg-blue-50/30 p-6 shadow-xs">
        <div className="mb-3 flex items-center gap-2">
          <Sigma className="h-5 w-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-900">5. Objective Function</h3>
        </div>
        <div className="rounded-lg border border-blue-100 bg-white px-4 py-3 text-slate-900">
          <MathBlock latex={formulation.objective_latex} displayMode />
        </div>
        <p className="mt-3 text-sm text-slate-700">{formulation.objective_explanation}</p>
      </section>

      {/* 6. Constraints */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <h3 className="mb-4 text-base font-semibold text-slate-900">6. Constraints</h3>
        <div className="space-y-4">
          {formulation.constraints.map((c, idx) => (
            <div key={idx} className="rounded-lg border border-slate-200 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-700">
                {c.name}
              </div>
              <div className="rounded-md bg-slate-50 px-3 py-2 text-slate-900">
                <MathBlock latex={c.latex} displayMode />
              </div>
              <p className="mt-2 text-xs text-slate-600">{c.explanation}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 7. Non-negativity & 8. Integrality */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
            7. Non-Negativity & Bounds
          </h3>
          <div className="rounded-lg bg-slate-50 px-4 py-3 text-slate-900">
            <MathBlock latex={formulation.non_negativity_latex} displayMode />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
            8. Integrality Conditions
          </h3>
          {formulation.integrality_latex ? (
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-slate-900">
              <MathBlock latex={formulation.integrality_latex} displayMode />
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              All decision variables in this model instance are continuous (Linear Program).
            </p>
          )}
        </div>
      </section>

      {/* 9. Numerical Values & 10. Solution Interpretation */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="mb-3 flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              9. Instance Numerical Summary
            </h3>
          </div>
          <dl className="divide-y divide-slate-100 text-sm">
            {Object.entries(formulation.numerical_summary).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between py-2">
                <dt className="font-medium capitalize text-slate-600">
                  {key.replace(/_/g, ' ')}
                </dt>
                <dd className="font-mono text-slate-900">
                  {typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '—')}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              10. Solution Interpretation
            </h3>
          </div>
          <ul className="space-y-2.5 text-sm text-slate-700">
            {formulation.solution_interpretation.map((line, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
};
