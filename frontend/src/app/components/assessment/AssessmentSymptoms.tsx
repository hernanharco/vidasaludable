import React from "react";
import { Checkbox } from "../ui/checkbox";
import { Symptom } from "./types";

interface AssessmentSymptomsProps {
  symptoms: Symptom[];
  responses: Map<number, boolean>;
  onToggle: (symptomId: number) => void;
}

export function AssessmentSymptoms({
  symptoms,
  responses,
  onToggle,
}: AssessmentSymptomsProps) {
  return (
    <div className="px-6 py-4">
      <div className="space-y-3">
        {symptoms.map((symptom) => {
          const isChecked = responses.get(symptom.id) ?? false;
          return (
            <label
              key={symptom.id}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                isChecked
                  ? "bg-emerald-50 border-emerald-200"
                  : "hover:bg-stone-50 border-stone-200"
              }`}
            >
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => onToggle(symptom.id)}
              />
              <span className="text-sm text-stone-700">
                {symptom.nameEs}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
