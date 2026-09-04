import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Menu, X, Shield } from "lucide-react";

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { name: "Inicio", href: "#" },
    { name: "Nosotros", href: "#about" },
    { name: "Enfoque", href: "#philosophy" },
  ];

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-white/95 backdrop-blur-md shadow-sm py-4"
          : "bg-transparent py-6"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between">
        <div className={`flex items-center gap-2 ${isScrolled ? "text-emerald-900" : "text-white"}`}>
          <Shield className="w-6 h-6" />
          <span className="font-bold text-xl tracking-wide">Salud Preventiva</span>
        </div>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-8">
          <ul className={`flex items-center gap-8 text-sm tracking-wide uppercase ${isScrolled ? "text-stone-600" : "text-white/80"}`}>
            {navLinks.map((link) => (
              <li key={link.name}>
                <a href={link.href} className={`transition-colors ${isScrolled ? "hover:text-emerald-900" : "hover:text-white"}`}>
                  {link.name}
                </a>
              </li>
            ))}
          </ul>
          <a
            href="#booking"
            className={`px-6 py-2.5 text-sm uppercase tracking-wider rounded-full font-medium transition-colors ${
              isScrolled
                ? "bg-emerald-900 text-white hover:bg-emerald-800"
                : "bg-white text-emerald-900 hover:bg-emerald-50"
            }`}
          >
            Agendar Cita
          </a>
        </div>

        {/* Mobile Toggle */}
        <button
          className={`md:hidden ${isScrolled ? "text-stone-800" : "text-white"}`}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="md:hidden bg-white border-b border-stone-200"
        >
          <ul className="flex flex-col px-6 py-4 gap-4 text-stone-600 text-sm tracking-wide uppercase">
            {navLinks.map((link) => (
              <li key={link.name}>
                <a
                  href={link.href}
                  className="block hover:text-emerald-900 transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.name}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#booking"
                className="inline-block mt-2 px-6 py-2.5 bg-emerald-900 text-white w-full text-center rounded-full hover:bg-emerald-800 transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Agendar Cita
              </a>
            </li>
          </ul>
        </motion.div>
      )}
    </motion.nav>
  );
}
