import React, { useState } from "react";
import { motion } from "motion/react";
import { Calendar as CalendarIcon, Clock, ChevronDown } from "lucide-react";

export function Booking() {
  const [formState, setFormState] = useState({
    name: "",
    email: "",
    date: "",
    reason: "",
  });

  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate API call
    setTimeout(() => {
      setSubmitted(true);
      setFormState({ name: "", email: "", date: "", reason: "" });
    }, 800);
  };

  return (
    <section id="booking" className="py-24 bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-900 text-stone-50 overflow-hidden relative">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-400/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-teal-400/20 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        
        {/* Text */}
        <motion.div 
          initial={{ opacity: 0, x: -50 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-xl"
        >
          <p className="text-emerald-300 font-semibold tracking-widest text-sm uppercase mb-3">
            Da el primer paso
          </p>
          <h2 className="text-4xl lg:text-5xl font-bold leading-tight mb-6">
            Tu plan preventivo comienza aquí.
          </h2>
          <p className="text-emerald-100/80 mb-10 leading-relaxed text-lg">
            Solicita una evaluación inicial. Analizaremos tu estilo de vida, hábitos y requerimientos 
            vitamínicos para crear un plan preventivo a tu medida.
          </p>
          
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center shrink-0">
                <CalendarIcon className="w-5 h-5 text-emerald-300" />
              </div>
              <div>
                <h4 className="font-semibold text-lg text-white">Disponibilidad</h4>
                <p className="text-emerald-200/70 text-sm">Martes a Jueves, 9:00 AM - 4:00 PM</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-emerald-300" />
              </div>
              <div>
                <h4 className="font-semibold text-lg text-white">Duración</h4>
                <p className="text-emerald-200/70 text-sm">Consultas iniciales de 60 minutos</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Form */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="bg-white rounded-2xl p-8 md:p-12 shadow-2xl relative z-10 text-stone-900"
        >
          {submitted ? (
            <div className="text-center py-16">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <CalendarIcon className="w-10 h-10" />
              </div>
              <h3 className="text-3xl font-bold text-emerald-900 mb-4">Solicitud Recibida</h3>
              <p className="text-stone-600 mb-8">
                Nuestro equipo se pondrá en contacto contigo en las próximas 24 horas para confirmar tu cita.
              </p>
              <button
                onClick={() => setSubmitted(false)}
                className="text-emerald-700 underline font-medium hover:text-emerald-900"
              >
                Solicitar otra cita
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <h3 className="text-2xl font-bold text-emerald-900 mb-6">Agenda tu Consulta</h3>
              
              <div className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1">
                    Nombre Completo
                  </label>
                  <input
                    type="text"
                    id="name"
                    required
                    value={formState.name}
                    onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                    className="w-full px-4 py-3 border border-stone-200 rounded-xl bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    placeholder="Tu nombre completo"
                  />
                </div>
                
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-1">
                    Correo Electrónico
                  </label>
                  <input
                    type="email"
                    id="email"
                    required
                    value={formState.email}
                    onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                    className="w-full px-4 py-3 border border-stone-200 rounded-xl bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    placeholder="correo@ejemplo.com"
                  />
                </div>

                <div>
                  <label htmlFor="date" className="block text-sm font-medium text-stone-700 mb-1">
                    Fecha Preferida (Tentativa)
                  </label>
                  <div className="relative">
                    <input
                      type="date"
                      id="date"
                      required
                      value={formState.date}
                      onChange={(e) => setFormState({ ...formState, date: e.target.value })}
                      className="w-full px-4 py-3 border border-stone-200 rounded-xl bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all appearance-none"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="reason" className="block text-sm font-medium text-stone-700 mb-1">
                    Motivo de Consulta
                  </label>
                  <div className="relative">
                    <select
                      id="reason"
                      required
                      value={formState.reason}
                      onChange={(e) => setFormState({ ...formState, reason: e.target.value })}
                      className="w-full px-4 py-3 border border-stone-200 rounded-xl bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all appearance-none"
                    >
                      <option value="" disabled>Selecciona una opción...</option>
                      <option value="vitaminas">Plan de Vitaminas y Suplementos</option>
                      <option value="habitos">Coaching de Hábitos</option>
                      <option value="integral">Evaluación Integral</option>
                      <option value="otro">Otro motivo</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-500 pointer-events-none" />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-4 bg-emerald-900 text-white font-semibold tracking-wide uppercase text-sm hover:bg-emerald-800 transition-colors mt-4 rounded-xl"
              >
                Solicitar Cita
              </button>
            </form>
          )}
        </motion.div>
      </div>
    </section>
  );
}
