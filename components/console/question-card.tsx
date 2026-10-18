"use client";

import { useState, type CSSProperties } from "react";
import { Check, Plus } from "lucide-react";
import type { Question, QuestionOption } from "@/lib/ai/interview";

/**
 * One question as tappable answers. Single choice answers on tap. Multi-select shows every option (grouped into
 * sections for the "what should we get?" list), pre-ticked where most people need it, plus "add your own".
 */
export function QuestionCard({
  question,
  picked,
  extra,
  onToggle,
  onAdd,
  onAnswer,
}: {
  question: Question;
  picked: string[];
  /** Options the person typed in themselves. */
  extra: QuestionOption[];
  onToggle: (label: string) => void;
  onAdd: (label: string) => void;
  onAnswer: (values: string[]) => void;
}) {
  const [adding, setAdding] = useState("");

  if (question.kind === "single") {
    return (
      <div className="q-card single" role="group" aria-label={question.ask}>
        {question.hint ? <p className="q-hint">{question.hint}</p> : null}
        <div className="q-options">
          {question.options.map((option, index) => (
            <button key={option.label} type="button" className="q-opt" style={{ "--i": index } as CSSProperties} onClick={() => onAnswer([option.label])}>
              <b>{option.label}</b>
              {option.detail ? <small>{option.detail}</small> : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const options = [...question.options, ...extra.map((option) => ({ ...option, group: question.topic === "items" ? "Added by you" : undefined }))];
  const groups = [...new Set(options.map((option) => option.group ?? ""))];
  let order = 0;

  return (
    <div className="q-card multi" role="group" aria-label={question.ask}>
      {question.hint ? <p className="q-hint">{question.hint}</p> : null}
      {groups.map((group) => (
        <div key={group || "all"} className="q-group">
          {group ? <span className="q-group-name">{group}</span> : null}
          <div className="q-options">
            {options
              .filter((option) => (option.group ?? "") === group)
              .map((option) => {
                const on = picked.includes(option.label);
                order += 1;
                return (
                  <button key={option.label} type="button" role="checkbox" aria-checked={on} className={`q-opt toggle${on ? " on" : ""}`} style={{ "--i": order } as CSSProperties} onClick={() => onToggle(option.label)}>
                    <span className="q-tick" aria-hidden="true">{on ? <Check /> : null}</span>
                    <span className="q-label">
                      <b>{option.label}</b>
                      {option.detail ? <small>{option.detail}</small> : null}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      ))}
      <form
        className="q-add"
        onSubmit={(event) => {
          event.preventDefault();
          const label = adding.replace(/\s+/g, " ").trim().slice(0, 40);
          if (label) onAdd(label);
          setAdding("");
        }}
      >
        <label className="sr-only" htmlFor={`add-${question.id}`}>Add something not listed</label>
        <input id={`add-${question.id}`} value={adding} placeholder="Add something not listed…" onChange={(event) => setAdding(event.target.value)} />
        <button type="submit" className="q-add-btn" aria-label="Add" disabled={!adding.trim()}><Plus aria-hidden="true" /></button>
      </form>
      <div className="q-foot">
        <span className="q-count">{picked.length} {question.topic === "owned" ? "owned" : "picked"}</span>
        <button type="button" className="btn btn-ghost" onClick={() => onAnswer([])}>{question.topic === "owned" ? "None of these" : "Skip"}</button>
        <button type="button" className="btn btn-accent" onClick={() => onAnswer(picked)} disabled={question.topic === "items" && picked.length === 0}>
          {question.topic === "items" ? `Use these ${picked.length}` : "Done"}
        </button>
      </div>
    </div>
  );
}
