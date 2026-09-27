import React from "react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";

interface AssessmentWelcomeProps {
  patientName: string;
  patientSex: "M" | "F" | "";
  patientAge: string;
  onNameChange: (v: string) => void;
  onSexChange: (v: "M" | "F") => void;
  onAgeChange: (v: string) => void;
}

export function AssessmentWelcome({
  patientName,
  patientSex,
  patientAge,
  onNameChange,
  onSexChange,
  onAgeChange,
}: AssessmentWelcomeProps) {
  return (
    <div className="p-6 space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold text-stone-800">
          Evaluación de Deficiencias
        </h3>
        <p className="text-stone-600 text-sm">
          Responda sobre sus síntomas para obtener recomendaciones
          personalizadas de prevención.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            value={patientName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Su nombre"
            className="mt-1"
          />
        </div>

        <div>
          <Label>Sexo</Label>
          <RadioGroup
            value={patientSex}
            onValueChange={(v) => onSexChange(v as "M" | "F")}
            className="flex gap-4 mt-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="M" id="sex-m" />
              <Label htmlFor="sex-m" className="font-normal">
                Masculino
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="F" id="sex-f" />
              <Label htmlFor="sex-f" className="font-normal">
                Femenino
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div>
          <Label htmlFor="age">Edad</Label>
          <Input
            id="age"
            type="number"
            value={patientAge}
            onChange={(e) => onAgeChange(e.target.value)}
            placeholder="Ej: 35"
            min={1}
            max={120}
            className="mt-1"
          />
        </div>
      </div>
    </div>
  );
}
