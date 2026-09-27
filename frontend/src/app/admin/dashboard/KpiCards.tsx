import { Link } from "react-router";
import { Users, Package, ShoppingCart, MessageSquareText, ShieldCheck } from "lucide-react";

interface KpiCardsProps {
  counts: {
    customers: number;
    products: number;
    purchases: number;
    conversations: number;
    recommendations: number;
  };
}

const kpis = [
  {
    label: "Clientes",
    key: "customers" as const,
    to: "/admin/customers",
    icon: Users,
    accent: "text-emerald-900 bg-emerald-50",
  },
  {
    label: "Productos",
    key: "products" as const,
    to: "/admin/catalog",
    icon: Package,
    accent: "text-emerald-800 bg-emerald-50",
  },
  {
    label: "Compras",
    key: "purchases" as const,
    to: "/admin/purchases",
    icon: ShoppingCart,
    accent: "text-stone-700 bg-stone-100",
  },
  {
    label: "Conversaciones",
    key: "conversations" as const,
    to: "/admin/conversations",
    icon: MessageSquareText,
    accent: "text-stone-700 bg-stone-100",
  },
  {
    label: "Recomendaciones",
    key: "recommendations" as const,
    to: "/admin/recommendations",
    icon: ShieldCheck,
    accent: "text-emerald-800 bg-emerald-50",
  },
];

export function KpiCards({ counts }: KpiCardsProps) {
  return (
    <div className="mt-6 grid grid-cols-2 lg:grid-cols-5 gap-4">
      {kpis.map((k) => (
        <Link
          key={k.label}
          to={k.to}
          className="block p-5 bg-white border border-stone-200 hover:border-emerald-800 transition-colors"
        >
          <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${k.accent}`}>
            <k.icon className="w-4.5 h-4.5" />
          </div>
          <p className="mt-3 text-sm uppercase tracking-wider text-stone-500">{k.label}</p>
          <p className="mt-1 text-3xl font-medium text-emerald-900">{counts[k.key]}</p>
        </Link>
      ))}
    </div>
  );
}
