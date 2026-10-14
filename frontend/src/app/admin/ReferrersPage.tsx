import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type ReferrerWithStats } from "./api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { DataTable, type DataTableColumn } from "./DataTable";

/**
 * CRM Referrers page — CRUD for access codes + stats.
 */

export function ReferrersPage() {
  const [referrers, setReferrers] = useState<ReferrerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");

  // New referrer form
  const [showForm, setShowForm] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadReferrers = async () => {
    try {
      setLoading(true);
      const data = await api.listReferrers();
      setReferrers(data.referrers);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Error loading referrers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReferrers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;

    setSaving(true);
    setSaveError(null);
    try {
      await api.createReferrer({
        code: newCode.trim(),
        name: newName.trim(),
        phone: newPhone.trim() || undefined,
        email: newEmail.trim() || undefined,
      });
      setNewCode("");
      setNewName("");
      setNewPhone("");
      setNewEmail("");
      setShowForm(false);
      await loadReferrers();
    } catch (e: any) {
      setSaveError(e.message ?? "Error creating referrer");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: number, currentActive: number) => {
    try {
      await api.updateReferrer(id, { active: currentActive ? 0 : 1 });
      await loadReferrers();
    } catch (e: any) {
      setError(e.message ?? "Error toggling referrer");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Desactivar este referente?")) return;
    try {
      await api.deleteReferrer(id);
      await loadReferrers();
    } catch (e: any) {
      setError(e.message ?? "Error deleting referrer");
    }
  };

  const startEdit = (r: ReferrerWithStats) => {
    setEditingId(r.id);
    setEditName(r.name);
    setEditPhone(r.phone ?? "");
    setEditEmail(r.email ?? "");
  };

  const handleSaveEdit = async (id: number) => {
    if (!editName.trim()) return;
    try {
      await api.updateReferrer(id, {
        name: editName.trim(),
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
      });
      setEditingId(null);
      await loadReferrers();
    } catch (e: any) {
      setError(e.message ?? "Error updating referrer");
    }
  };

  type ReferrerCustomer = ReferrerWithStats["customers"][number];

  // Nested expanded table: customers of one referrer. Kept non-sortable to
  // preserve its minimal inline look.
  const nestedColumns: DataTableColumn<ReferrerCustomer>[] = [
    { key: "name", header: "Nombre", render: (cu) => cu.name },
    {
      key: "email",
      header: "Email",
      cellClassName: "text-stone-500",
      render: (cu) => cu.email,
    },
    {
      key: "phone",
      header: "Teléfono",
      cellClassName: "text-stone-500",
      render: (cu) => cu.phone,
    },
    {
      key: "registered",
      header: "Registrado",
      cellClassName: "text-stone-500",
      render: (cu) => new Date(cu.registeredAt).toLocaleDateString(),
    },
    {
      key: "ficha",
      header: "Acciones",
      align: "right",
      render: (cu) => (
        <Link
          to={`/admin/customers/${cu.id}`}
          className="text-xs text-emerald-700 hover:text-emerald-900 hover:underline"
        >
          Ver ficha
        </Link>
      ),
    },
  ];

  const columns: DataTableColumn<ReferrerWithStats>[] = [
    {
      key: "code",
      header: "Código",
      sortable: true,
      cellClassName: "font-mono text-xs",
      render: (r) => r.code,
    },
    {
      key: "name",
      header: "Nombre",
      sortable: true,
      render: (r) =>
        editingId === r.id ? (
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
        ) : (
          r.name
        ),
    },
    {
      key: "phone",
      header: "Teléfono",
      sortable: true,
      render: (r) =>
        editingId === r.id ? (
          <Input
            value={editPhone}
            onChange={(e) => setEditPhone(e.target.value)}
            placeholder="Teléfono"
          />
        ) : (
          <span className="text-stone-500">{r.phone ?? "—"}</span>
        ),
    },
    {
      key: "email",
      header: "Email",
      sortable: true,
      render: (r) =>
        editingId === r.id ? (
          <Input
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
            placeholder="Email"
          />
        ) : (
          <span className="text-stone-500">{r.email ?? "—"}</span>
        ),
    },
    {
      key: "customers",
      header: "Clientes",
      align: "center",
      sortable: true,
      render: (r) => (
        <button
          onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
          className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200"
          title="Ver clientes"
        >
          {r.customerCount}
        </button>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      align: "center",
      sortable: true,
      render: (r) => (
        <span
          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
            r.active ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-500"
          }`}
        >
          {r.active ? "Activo" : "Inactivo"}
        </span>
      ),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      cellClassName: "space-x-2",
      render: (r) =>
        editingId === r.id ? (
          <>
            <button
              onClick={() => handleSaveEdit(r.id)}
              className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
            >
              Guardar
            </button>
            <button
              onClick={() => setEditingId(null)}
              className="text-xs text-stone-500 hover:text-stone-700"
            >
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => startEdit(r)}
              className="text-xs text-emerald-600 hover:text-emerald-800"
            >
              Editar
            </button>
            <button
              onClick={() => handleToggle(r.id, r.active)}
              className="text-xs text-stone-500 hover:text-stone-700"
            >
              {r.active ? "Desactivar" : "Activar"}
            </button>
            <button
              onClick={() => handleDelete(r.id)}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Eliminar
            </button>
          </>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Referentes</h1>
          <p className="text-sm text-stone-500 mt-1">
            Códigos de acceso para rastrear quién invita a cada persona.
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="bg-emerald-600 hover:bg-emerald-700">
          {showForm ? "Cancelar" : "+ Nuevo Referente"}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-stone-600">
              Código de acceso *
              <Input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="Ej: 1906432239"
                required
              />
            </label>
            <label className="text-xs text-stone-600">
              Nombre completo *
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej: Hernan Arango"
                required
              />
            </label>
            <label className="text-xs text-stone-600">
              Teléfono (opcional)
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="Teléfono"
              />
            </label>
            <label className="text-xs text-stone-600">
              Email (opcional)
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="correo@ejemplo.com"
              />
            </label>
          </div>
          {saveError && (
            <p className="text-xs text-red-600">{saveError}</p>
          )}
          <Button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
            {saving ? "Guardando..." : "Crear Referente"}
          </Button>
        </form>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-stone-500 text-sm">Cargando referentes...</p>
      ) : referrers.length === 0 ? (
        <div className="bg-stone-50 rounded-xl border border-stone-200 p-8 text-center">
          <p className="text-stone-500">No hay referentes creados todavía.</p>
          <p className="text-xs text-stone-400 mt-1">
            Creá uno con "+ Nuevo Referente" para empezar a rastrear referidos.
          </p>
        </div>
      ) : (
        <>
        {/* Desktop: table (md and up) */}
        <div className="hidden md:block">
          <DataTable
            columns={columns}
            rows={referrers}
            getRowKey={(r) => String(r.id)}
            emptyMessage="No hay referentes creados todavía."
            containerClassName="bg-white rounded-xl border border-stone-200"
            tableClassName="min-w-[720px]"
            renderExpandedRow={(r) =>
              r.customers.length === 0 ? (
                <p className="text-xs text-stone-500">Sin clientes asociados.</p>
              ) : (
                <DataTable
                  columns={nestedColumns}
                  rows={r.customers}
                  getRowKey={(cu) => String(cu.id)}
                  emptyMessage="Sin clientes asociados."
                  tableClassName="min-w-[720px] text-xs"
                  thClassName="px-0 py-1 font-normal text-stone-500"
                  tdClassName="px-0 py-1"
                />
              )
            }
          />
        </div>

        {/* Mobile: cards (below md) — one referrer per card, no horizontal scroll */}
        <div className="md:hidden space-y-3">
          {referrers.map((r) => (
            <div key={r.id} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
              {editingId === r.id ? (
                <div className="space-y-2">
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Nombre" />
                  <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Teléfono" aria-label="Teléfono" />
                  <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" aria-label="Email" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleSaveEdit(r.id)} className="bg-emerald-600 hover:bg-emerald-700 flex-1">
                      Guardar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="flex-1">
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-stone-900 break-words">{r.name}</p>
                      <p className="text-xs font-mono text-stone-500 mt-0.5">🔑 {r.code}</p>
                    </div>
                    <span
                      className={`shrink-0 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.active ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-500"
                      }`}
                    >
                      {r.active ? "Activo" : "Inactivo"}
                    </span>
                  </div>

                  <div className="text-xs text-stone-500 space-y-0.5">
                    <p>Teléfono: {r.phone ?? "—"}</p>
                    <p>Email: {r.email ?? "—"}</p>
                  </div>

                  <button
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200"
                  >
                    👥 {r.customerCount} {r.customerCount === 1 ? "cliente" : "clientes"}
                  </button>

                  {expandedId === r.id && (
                    <div className="border-t border-stone-100 pt-2 space-y-2">
                      {r.customers.length === 0 ? (
                        <p className="text-xs text-stone-500">Sin clientes asociados.</p>
                      ) : (
                        r.customers.map((cu) => (
                          <div key={cu.id} className="text-xs bg-stone-50 rounded-lg p-2 space-y-0.5">
                            <p className="font-medium text-stone-800">{cu.name}</p>
                            <p className="text-stone-500">{cu.email}</p>
                            <p className="text-stone-500">{cu.phone}</p>
                            <p className="text-stone-400">Registrado: {new Date(cu.registeredAt).toLocaleDateString()}</p>
                            <Link
                              to={`/admin/customers/${cu.id}`}
                              className="inline-block mt-1 text-xs text-emerald-700 hover:text-emerald-900 hover:underline"
                            >
                              Ver ficha
                            </Link>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => startEdit(r)} className="flex-1">
                      Editar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleToggle(r.id, r.active)} className="flex-1">
                      {r.active ? "Desactivar" : "Activar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(r.id)}
                      className="flex-1 text-red-500 hover:text-red-700 hover:border-red-300"
                    >
                      Eliminar
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
