import React from "react";
import { AlertTriangle, AlertCircle, CheckCircle2, Pill, ShoppingCart } from "lucide-react";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { ScoringResult, ProductRecommendation, STATUS_CONFIG } from "./types";

interface AssessmentResultsProps {
  results: ScoringResult[];
  recommendations: ScoringResult[];
  productRecommendations: ProductRecommendation[];
  expandedNutrient: string | null;
  onToggleNutrient: (id: string) => void;
}

const ICONS = {
  OK: CheckCircle2,
  deficient: AlertTriangle,
  urgent: AlertCircle,
};

export function AssessmentResults({
  results,
  recommendations,
  productRecommendations,
  expandedNutrient,
  onToggleNutrient,
}: AssessmentResultsProps) {
  return (
    <div className="px-6 py-4 space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="p-3 bg-emerald-50 rounded-lg">
          <div className="text-2xl font-bold text-emerald-600">
            {results.filter((r) => r.status === "OK").length}
          </div>
          <div className="text-xs text-emerald-700">OK</div>
        </div>
        <div className="p-3 bg-amber-50 rounded-lg">
          <div className="text-2xl font-bold text-amber-600">
            {results.filter((r) => r.status === "deficient").length}
          </div>
          <div className="text-xs text-amber-700">En Falta</div>
        </div>
        <div className="p-3 bg-red-50 rounded-lg">
          <div className="text-2xl font-bold text-red-600">
            {results.filter((r) => r.status === "urgent").length}
          </div>
          <div className="text-xs text-red-700">Urgente</div>
        </div>
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div>
          <h4 className="font-medium text-stone-800 mb-2">Recomendaciones</h4>
          <div className="space-y-2">
            {recommendations.map((rec) => {
              const config = STATUS_CONFIG[rec.status];
              const Icon = ICONS[rec.status];
              return (
                <div
                  key={rec.nutrientId}
                  className="flex items-center justify-between p-3 bg-stone-50 rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      size={16}
                      className={
                        rec.status === "urgent" ? "text-red-600" : "text-amber-600"
                      }
                    />
                    <span className="text-sm font-medium text-stone-700">
                      {rec.nutrientName}
                    </span>
                  </div>
                  <Badge className={config.color}>
                    {config.label} ({Math.round(rec.ratio * 100)}%)
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Product Recommendations */}
      {productRecommendations.length > 0 && (
        <div>
          <h4 className="font-medium text-stone-800 mb-3">Productos Recomendados</h4>
          <div className="space-y-3">
            {productRecommendations.map((product) => (
              <Card key={product.reference} className="overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-sm">{product.name}</CardTitle>
                      <CardDescription className="text-xs mt-1">
                        {product.category}
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-emerald-700">
                        €{product.price.toFixed(2)}
                      </div>
                      <div className="text-xs text-stone-400">{product.size}</div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-stone-600 mb-2">{product.benefits}</p>
                  <div className="flex items-center gap-1 text-xs text-stone-500 mb-3">
                    <Pill size={12} />
                    <span>{product.dosage}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {product.addressesNutrients.map((n) => {
                      const config = STATUS_CONFIG[n.status];
                      return (
                        <Badge key={n.nutrientId} className={`${config.color} text-xs`}>
                          {n.nutrientName}
                        </Badge>
                      );
                    })}
                  </div>
                </CardContent>
                <CardFooter className="pt-0 pb-4">
                  <a
                    href={`https://www.amway.es/search?q=${encodeURIComponent(product.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 w-full justify-center bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    <ShoppingCart size={14} />
                    Consultar precio
                  </a>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* All nutrients */}
      <div className="pb-4">
        <h4 className="font-medium text-stone-800 mb-2">Todos los Nutrientes</h4>
        <div className="space-y-1">
          {results
            .sort((a, b) => {
              const order = { urgent: 0, deficient: 1, OK: 2 };
              return order[a.status] - order[b.status];
            })
            .map((r) => {
              const config = STATUS_CONFIG[r.status];
              const isExpanded = expandedNutrient === r.nutrientId;
              return (
                <div key={r.nutrientId}>
                  <button
                    onClick={() => onToggleNutrient(r.nutrientId)}
                    className="w-full flex items-center justify-between p-2 rounded hover:bg-stone-50 text-sm"
                  >
                    <span className="text-stone-700">{r.nutrientName}</span>
                    <Badge className={`${config.color} text-xs`}>{config.label}</Badge>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-2 text-xs text-stone-500">
                      Score: {r.matchedWeight}/{r.maxWeight} ={" "}
                      {Math.round(r.ratio * 100)}%
                      <div className="mt-1 h-2 bg-stone-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            r.status === "urgent"
                              ? "bg-red-500"
                              : r.status === "deficient"
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(r.ratio * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
