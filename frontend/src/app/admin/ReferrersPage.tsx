import React, { useEffect, useState } from "react";
import { api, type ReferrerWithStats } from "./api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

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
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50">
                <th className="text-left px-4 py-3 font-medium text-stone-600">Código</th>
                <th className="text-left px-4 py-3 font-medium text-stone-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-stone-600">Teléfono</th>
                <th className="text-left px-4 py-3 font-medium text-stone-600">Email</th>
                <th className="text-center px-4 py-3 font-medium text-stone-600">Clientes</th>
                <th className="text-center px-4 py-3 font-medium text-stone-600">Estado</th>
                <th className="text-right px-4 py-3 font-medium text-stone-600">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {referrers.map((r) => (
                <React.Fragment key={r.id}>
                <tr className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                  {editingId === r.id ? (
                    <>
                      <td className="px-4 py-3">
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="text-sm" />
                      </td>
                      <td className="px-4 py-3">
                        <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Teléfono" className="text-sm" />
                      </td>
                      <td className="px-4 py-3">
                        <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" className="text-sm" />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3">{r.name}</td>
                      <td className="px-4 py-3 text-stone-500">{r.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-stone-500">{r.email ?? "—"}</td>
                    </>
                  )}
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200"
                      title="Ver clientes"
                    >
                      {r.customerCount}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.active
                          ? "bg-green-100 text-green-700"
                          : "bg-stone-100 text-stone-500"
                      }`}
                    >
                      {r.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {editingId === r.id ? (
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
                    )}
                  </td>
                </tr>
                {expandedId === r.id && (
                  <tr key={`${r.id}-expanded`}>
                    <td colSpan={7} className="px-4 py-3 bg-stone-50">
                      {r.customers.length === 0 ? (
                        <p className="text-xs text-stone-500">Sin clientes asociados.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-stone-500">
                              <th className="text-left py-1">Nombre</th>
                              <th className="text-left py-1">Email</th>
                              <th className="text-left py-1">Teléfono</th>
                              <th className="text-left py-1">Registrado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.customers.map((cu) => (
                              <tr key={cu.id} className="border-t border-stone-200">
                                <td className="py-1">{cu.name}</td>
                                <td className="py-1 text-stone-500">{cu.email}</td>
                                <td className="py-1 text-stone-500">{cu.phone}</td>
                                <td className="py-1 text-stone-500">{new Date(cu.registeredAt).toLocaleDateString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
