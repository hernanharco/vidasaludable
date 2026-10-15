import { useEffect, useState } from "react";
import { api, Customer, Product, Purchase } from "./api";
import { DataTable, type DataTableColumn } from "./DataTable";

export function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [customerId, setCustomerId] = useState("");
  const [productReference, setProductReference] = useState("");
  const [qty, setQty] = useState(1);

  useEffect(() => {
    Promise.all([api.listPurchases(), api.listCustomers(), api.listProducts()])
      .then(([pu, cu, p]) => {
        setPurchases(pu.purchases);
        setCustomers(cu.customers);
        setProducts(p.products);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error de red"))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId || !productReference) return;
    setSaving(true);
    try {
      await api.createPurchase({
        customerId: Number(customerId),
        productReference,
        qty,
      });
      const res = await api.listPurchases();
      setPurchases(res.purchases);
      setProductReference("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear compra");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-stone-500">Cargando…</p>;
  if (error && purchases.length === 0 && customers.length === 0) {
    return (
      <div className="max-w-2xl p-6 bg-amber-50 border border-amber-300 text-amber-900">
        <h1 className="font-serif text-xl">Acceso restringido</h1>
        <p className="mt-2 text-sm">Respuesta del backend: {error}</p>
      </div>
    );
  }

  const columns: DataTableColumn<Purchase>[] = [
    { key: "id", header: "ID", sortable: true, render: (p) => p.id },
    {
      key: "cliente",
      header: "Cliente",
      align: "right",
      sortable: true,
      render: (p) => p.customerId,
    },
    {
      key: "producto",
      header: "Producto",
      sortable: true,
      cellClassName: "font-mono text-xs",
      render: (p) => p.productReference,
    },
    { key: "qty", header: "Qty", align: "right", sortable: true, render: (p) => p.qty },
    {
      key: "fecha",
      header: "Fecha",
      align: "right",
      sortable: true,
      cellClassName: "text-xs text-stone-500",
      render: (p) => new Date(p.purchasedAt).toLocaleString(),
    },
  ];

  return (
    <div>
      <h1 className="font-serif text-2xl">Compras</h1>
      <p className="mt-1 text-sm text-stone-500">
        Historial de compras inyectado en el contexto del agente.
      </p>

      <form onSubmit={handleCreate} className="mt-6 p-6 bg-white border border-stone-200 space-y-4">
        <h2 className="font-serif text-lg">Registrar compra demo</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block text-sm">
            Cliente
            <select
              className="mt-1 w-full border border-stone-300 px-3 py-2"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            >
              <option value="">Seleccionar…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.id} {c.name} ({c.email})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Producto
            <select
              className="mt-1 w-full border border-stone-300 px-3 py-2"
              value={productReference}
              onChange={(e) => setProductReference(e.target.value)}
              required
            >
              <option value="">Seleccionar…</option>
              {products.map((p) => (
                <option key={p.reference} value={p.reference}>
                  {p.reference} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Cantidad
            <input
              className="mt-1 w-full border border-stone-300 px-3 py-2"
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              required
            />
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-emerald-900 text-stone-50 text-sm hover:bg-emerald-800 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Crear compra"}
        </button>
      </form>

      <DataTable
        columns={columns}
        rows={purchases}
        getRowKey={(p) => String(p.id)}
        emptyMessage="No hay compras registradas todavía."
        searchable
        searchText={(p) => `${p.productReference} ${p.customerId} ${p.id}`}
        containerClassName="mt-6 bg-white border border-stone-200"
      />
    </div>
  );
}