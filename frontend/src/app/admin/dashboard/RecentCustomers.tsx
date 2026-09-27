import { Customer } from "../api";

interface RecentCustomersProps {
  customers: Customer[];
}

export function RecentCustomers({ customers }: RecentCustomersProps) {
  return (
    <div className="bg-white border border-stone-200 p-5">
      <h2 className="text-sm font-medium text-stone-700">Clientes recientes</h2>
      {customers.length === 0 ? (
        <p className="mt-6 text-sm text-stone-400">Sin clientes registrados todavía.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-stone-400 border-b border-stone-100">
                <th className="py-2 pr-3 font-medium">Cliente</th>
                <th className="py-2 pr-3 font-medium">Email</th>
                <th className="py-2 pr-3 font-medium">Teléfono</th>
                <th className="py-2 font-medium">Referido por</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {customers.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 pr-3 text-stone-800">{c.name}</td>
                  <td className="py-2 pr-3 text-stone-500">{c.email}</td>
                  <td className="py-2 pr-3 text-stone-500">{c.phone}</td>
                  <td className="py-2 text-stone-500">{c.referrerPhone ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
