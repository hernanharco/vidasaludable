import { useCallback, useEffect, useState } from "react";
import { api, Product, ProductInput } from "./api";

const EMPTY: ProductInput = {
  reference: "",
  name: "",
  category: "",
  size: "",
  price: 0,
  benefits: "",
  dosage: "",
  ingredients: "",
  disclaimer: "",
};

export function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ProductInput | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.listProducts();
      setProducts(res.products);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isNew = editing != null && !products.some((p) => p.reference === editing.reference);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      if (isNew) {
        await api.createProduct(editing);
      } else {
        const { reference, ...patch } = editing;
        await api.updateProduct(reference, patch);
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const set = (field: keyof ProductInput, value: string | number) =>
    setEditing((prev) => (prev ? { ...prev, [field]: value } : prev));

  if (loading) return <p className="text-stone-500">Cargando…</p>;
  if (error && !editing) {
    return (
      <div className="max-w-2xl p-6 bg-amber-50 border border-amber-300 text-amber-900">
        <h2 className="font-serif text-xl">Acceso restringido</h2>
        <p className="mt-2 text-sm">Respuesta del backend: {error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl">Catálogo</h1>
          <p className="mt-1 text-sm text-stone-500">
            Productos Nutrilite. Edición sin borrado: los productos referenciados por
            compras o recomendaciones no se eliminan.
          </p>
        </div>
        <button
          onClick={() => setEditing(EMPTY)}
          className="px-4 py-2 bg-emerald-900 text-stone-50 text-sm hover:bg-emerald-800"
        >
          Nuevo producto
        </button>
      </div>

      {editing && (
        <form onSubmit={handleSubmit} className="mt-6 p-6 bg-white border border-stone-200 space-y-4">
          <h2 className="font-serif text-lg">{isNew ? "Nuevo producto" : `Editar ${editing.reference}`}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block text-sm">
              Reference
              <input
                className="mt-1 w-full border border-stone-300 px-3 py-2"
                value={editing.reference}
                disabled={!isNew}
                onChange={(e) => set("reference", e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              Nombre
              <input
                className="mt-1 w-full border border-stone-300 px-3 py-2"
                value={editing.name}
                onChange={(e) => set("name", e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              Categoría
              <input
                className="mt-1 w-full border border-stone-300 px-3 py-2"
                value={editing.category}
                onChange={(e) => set("category", e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              Tamaño
              <input
                className="mt-1 w-full border border-stone-300 px-3 py-2"
                value={editing.size}
                onChange={(e) => set("size", e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              Precio (€)
              <input
                className="mt-1 w-full border border-stone-300 px-3 py-2"
                type="number"
                step="0.01"
                min="0"
                value={editing.price}
                onChange={(e) => set("price", Number(e.target.value))}
                required
              />
            </label>
          </div>
          <label className="block text-sm">
            Beneficios
            <textarea
              className="mt-1 w-full border border-stone-300 px-3 py-2"
              rows={2}
              value={editing.benefits}
              onChange={(e) => set("benefits", e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            Dosis
            <input
              className="mt-1 w-full border border-stone-300 px-3 py-2"
              value={editing.dosage}
              onChange={(e) => set("dosage", e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            Ingredientes
            <textarea
              className="mt-1 w-full border border-stone-300 px-3 py-2"
              rows={2}
              value={editing.ingredients}
              onChange={(e) => set("ingredients", e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            Disclaimer
            <textarea
              className="mt-1 w-full border border-stone-300 px-3 py-2"
              rows={2}
              value={editing.disclaimer}
              onChange={(e) => set("disclaimer", e.target.value)}
              required
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-emerald-900 text-stone-50 text-sm hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? "Guardando…" : isNew ? "Crear" : "Guardar cambios"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
              className="px-4 py-2 border border-stone-300 text-stone-600 text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 overflow-x-auto bg-white border border-stone-200">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-stone-600 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left">Reference</th>
              <th className="px-4 py-3 text-left">Nombre</th>
              <th className="px-4 py-3 text-left">Categoría</th>
              <th className="px-4 py-3 text-right">Precio</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.reference} className="border-t border-stone-200">
                <td className="px-4 py-3 font-mono text-xs">{p.reference}</td>
                <td className="px-4 py-3">{p.name}</td>
                <td className="px-4 py-3">{p.category}</td>
                <td className="px-4 py-3 text-right">{p.price.toFixed(2)} €</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    onClick={() => {
                      setEditing({ ...p });
                      setError(null);
                    }}
                    className="text-emerald-800 hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`¿Eliminar el producto ${p.reference}?`)) return;
                      try {
                        await api.deleteProduct(p.reference);
                        await load();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Error al eliminar");
                      }
                    }}
                    className="text-red-500 hover:text-red-700"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}