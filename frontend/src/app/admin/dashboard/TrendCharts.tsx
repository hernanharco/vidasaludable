import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface TrendData {
  key: string;
  label: string;
  registros: number;
  recomendaciones: number;
}

interface TrendChartsProps {
  trend: TrendData[];
}

const tooltipStyle = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #d6d3d1",
  boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
};

export function TrendCharts({ trend }: TrendChartsProps) {
  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white border border-stone-200 p-5">
        <h2 className="text-sm font-medium text-stone-700">Registros de clientes · 14 días</h2>
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="gRegistros" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#064e3b" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#064e3b" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e7e5e4" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#78716c" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#78716c" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area
                type="monotone"
                dataKey="registros"
                name="Registros"
                stroke="#064e3b"
                strokeWidth={2}
                fill="url(#gRegistros)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white border border-stone-200 p-5">
        <h2 className="text-sm font-medium text-stone-700">Recomendaciones · 14 días</h2>
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="gRecom" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#047857" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#047857" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e7e5e4" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#78716c" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#78716c" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area
                type="monotone"
                dataKey="recomendaciones"
                name="Recomendaciones"
                stroke="#047857"
                strokeWidth={2}
                fill="url(#gRecom)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
