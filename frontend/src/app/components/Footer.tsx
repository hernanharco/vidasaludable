import React from "react";
import { Shield, Instagram, Facebook, Mail, Phone, MapPin } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-stone-900 text-stone-300 py-16 border-t border-stone-800">
      <div className="max-w-7xl mx-auto px-6 md:px-12 grid grid-cols-1 md:grid-cols-4 gap-12">
        
        {/* Brand */}
        <div className="col-span-1 md:col-span-1">
          <div className="flex items-center gap-2 text-emerald-400 mb-6">
            <Shield className="w-6 h-6" />
            <span className="font-bold text-xl tracking-wide text-white">Salud Preventiva</span>
          </div>
          <p className="text-sm text-stone-400 leading-relaxed mb-6">
            Bienestar integral, nutrición celular y medicina funcional preventiva.
          </p>
          <div className="flex items-center gap-4">
            <a href="#" className="text-stone-400 hover:text-emerald-400 transition-colors">
              <Instagram className="w-5 h-5" />
            </a>
            <a href="#" className="text-stone-400 hover:text-emerald-400 transition-colors">
              <Facebook className="w-5 h-5" />
            </a>
          </div>
        </div>

        {/* Links */}
        <div>
          <h4 className="text-white font-medium uppercase text-sm tracking-wider mb-6">Explorar</h4>
          <ul className="space-y-3 text-sm">
            <li><a href="#" className="hover:text-emerald-400 transition-colors">Inicio</a></li>
            <li><a href="#about" className="hover:text-emerald-400 transition-colors">Nosotros</a></li>
            <li><a href="#philosophy" className="hover:text-emerald-400 transition-colors">Enfoque y Servicios</a></li>
            <li><a href="#booking" className="hover:text-emerald-400 transition-colors">Agendar Cita</a></li>
          </ul>
        </div>

        {/* Contact */}
        <div className="col-span-1 md:col-span-2">
          <h4 className="text-white font-medium uppercase text-sm tracking-wider mb-6">Contacto</h4>
          <ul className="space-y-4 text-sm">
            <li className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>Consultas presenciales y virtuales con cita previa</span>
            </li>
            <li className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>+1 (555) 123-4567</span>
            </li>
            <li className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>consultas@saludpreventiva.com</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 md:px-12 mt-16 pt-8 border-t border-stone-800 text-sm text-stone-500 flex flex-col md:flex-row justify-between items-center gap-4">
        <p>© {new Date().getFullYear()} Salud Preventiva. Todos los derechos reservados.</p>
        <div className="flex gap-4">
          <a href="#" className="hover:text-stone-300">Términos de servicio</a>
          <a href="#" className="hover:text-stone-300">Política de privacidad</a>
        </div>
      </div>
    </footer>
  );
}
