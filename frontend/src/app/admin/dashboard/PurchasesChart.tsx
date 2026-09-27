import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface PurchaseData {
  name: string;
  qty: number;
}

interface PurchasesChartProps {
  purchases: PurchaseData[];
}

const tooltipStyle = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #d6d3d1",
  boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
};

export function PurchasesChart({ purchases }: PurchasesChartProps) {
  return (
    <div className="bg-white border border-stone-200 p-5">
      <h2 className="text-sm font-medium text-stone-700">Compras por producto</h2>
      {purchases.length === 0 ? (
        <p className="mt-6 text-sm text-stone-400">Sin compras registradas todavía.</p>
      ) : (
        <div className="mt-3 h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={purchases} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="#e7e5e4" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "#78716c" }}
                tickLine={false}
                axisLine={false}
                interval={0}
                angle={-12}
                textAnchor="end"
                height={48}
              />
              <YAxis tick={{ fontSize: 11, fill: "#78716c" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f5f5f4" }} />
              <Bar dataKey="qty" name="Unidades" fill="#047857" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
