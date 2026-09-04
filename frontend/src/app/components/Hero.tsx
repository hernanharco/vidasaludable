import React from "react";
import { motion } from "motion/react";
import { ArrowRight, Shield, Zap, Heart } from "lucide-react";

export function Hero() {
  return (
    <section className="relative min-h-[90vh] flex items-center overflow-hidden bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-900" id="#">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-400/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-teal-400/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 py-20 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Text Content */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-xl"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-emerald-100 text-xs font-semibold uppercase tracking-wider mb-8"
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Plataforma de Salud Preventiva</span>
          </motion.div>

          <h1 className="text-5xl lg:text-7xl font-bold text-white leading-[1.1] mb-6">
            Cuida tu salud{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-teal-200">
              antes de que sea tarde.
            </span>
          </h1>

          <p className="text-lg text-emerald-100/80 leading-relaxed mb-10 max-w-lg">
            Nutrición celular, suplementación inteligente y hábitos sostenibles. 
            Un enfoque integral para potenciar tu bienestar a largo plazo.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <a
              href="#booking"
              className="inline-flex items-center justify-center px-8 py-4 bg-white text-emerald-900 font-semibold tracking-wide text-sm hover:bg-emerald-50 transition-all group rounded-full shadow-lg shadow-emerald-900/30"
            >
              Comienza tu plan preventivo
              <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="#about"
              className="inline-flex items-center justify-center px-8 py-4 bg-transparent border-2 border-white/30 text-white font-medium tracking-wide text-sm hover:bg-white/10 transition-colors rounded-full"
            >
              Conoce nuestro enfoque
            </a>
          </div>

          {/* Stats */}
          <div className="flex gap-8 mt-12 pt-8 border-t border-white/20">
            <div>
              <p className="text-3xl font-bold text-white">100%</p>
              <p className="text-xs text-emerald-200/70 uppercase tracking-wider">Enfoque preventivo</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-white">360°</p>
              <p className="text-xs text-emerald-200/70 uppercase tracking-wider">Visión integral</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-white">24/7</p>
              <p className="text-xs text-emerald-200/70 uppercase tracking-wider">Recomendaciones</p>
            </div>
          </div>
        </motion.div>

        {/* Right side — feature cards */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="relative hidden lg:block"
        >
          <div className="relative space-y-6">
            {/* Card 1 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 ml-12"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-400/20 rounded-xl flex items-center justify-center">
                  <Heart className="w-6 h-6 text-emerald-300" />
                </div>
                <div>
                  <h3 className="text-white font-semibold">Nutrición Celular</h3>
                  <p className="text-emerald-200/70 text-sm">Suplementación basada en ciencia</p>
                </div>
              </div>
            </motion.div>

            {/* Card 2 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 mr-8"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-teal-400/20 rounded-xl flex items-center justify-center">
                  <Zap className="w-6 h-6 text-teal-300" />
                </div>
                <div>
                  <h3 className="text-white font-semibold">Hábitos Inteligentes</h3>
                  <p className="text-emerald-200/70 text-sm">Rutinas sostenibles para tu vida real</p>
                </div>
              </div>
            </motion.div>

            {/* Card 3 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9 }}
              className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 ml-4"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-400/20 rounded-xl flex items-center justify-center">
                  <Shield className="w-6 h-6 text-emerald-300" />
                </div>
                <div>
                  <h3 className="text-white font-semibold">Prevención Activa</h3>
                  <p className="text-emerald-200/70 text-sm">Anticípate a los problemas de salud</p>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
