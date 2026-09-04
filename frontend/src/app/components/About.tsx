import React from "react";
import { motion } from "motion/react";
import { Heart, Shield, Users, Leaf } from "lucide-react";

export function About() {
  const values = [
    {
      icon: <Shield className="w-6 h-6" />,
      title: "Prevención",
      description: "Anticipar problemas de salud con hábitos inteligentes antes de que se conviertan en enfermedades."
    },
    {
      icon: <Leaf className="w-6 h-6" />,
      title: "Nutrición Celular",
      description: "Suplementación estratégica basada en ciencia para optimizar tu cuerpo desde adentro."
    },
    {
      icon: <Heart className="w-6 h-6" />,
      title: "Bienestar Integral",
      description: "Un enfoque que integra cuerpo, mente y estilo de vida para resultados sostenibles."
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: "Acompañamiento",
      description: "No solo recomendaciones, sino un plan personalizado que se adapta a tu realidad diaria."
    }
  ];

  return (
    <section id="about" className="py-24 bg-white relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 md:px-12 grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
        
        {/* Images */}
        <motion.div 
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative h-full w-full min-h-[500px]"
        >
          {/* Main Photo */}
          <div className="relative z-10 w-4/5 h-[450px] lg:h-[600px] ml-auto overflow-hidden shadow-2xl rounded-2xl">
            <img 
              src="https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxoZWFsdGh5JTIwd2VsbG5lc3MlMjBmaXRuZXNzfGVufDF8fHx8MTc3MzA0NjIyNHww&ixlib=rb-4.1.0&q=80&w=1080" 
              alt="Bienestar y salud preventiva" 
              className="w-full h-full object-cover"
            />
          </div>
          {/* Overlapping Photo */}
          <div className="absolute bottom-10 left-0 z-20 w-3/5 h-[300px] shadow-xl border-4 border-white overflow-hidden rounded-xl">
             <img 
              src="https://images.unsplash.com/photo-1505576399279-0a997dd7e2f8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxoZWFsdGh5JTIwbGlmZXN0eWxlJTIwd2VsbG5lc3N8ZW58MXx8fHwxNzczMDQ2MjI0fDA&ixlib=rb-4.1.0&q=80&w=1080" 
              alt="Estilo de vida saludable" 
              className="w-full h-full object-cover"
            />
          </div>
          {/* Deco Pattern */}
          <div className="absolute top-1/4 right-0 w-32 h-32 bg-emerald-50 rounded-full -z-10 blur-3xl opacity-50" />
        </motion.div>

        {/* Text */}
        <motion.div 
          initial={{ opacity: 0, x: 50 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <p className="text-emerald-600 font-semibold tracking-widest text-sm uppercase mb-3">
            Nuestro Enfoque
          </p>
          <h2 className="text-4xl lg:text-5xl font-bold text-stone-900 leading-tight mb-8">
            La salud preventiva como base de una vida plena.
          </h2>
          <p className="text-stone-600 mb-6 leading-relaxed text-lg">
            Creemos que la mejor manera de cuidar tu salud es anticipándote. 
            A través de la nutrición celular, la suplementación estratégica y la construcción 
            de hábitos sostenibles, te ayudamos a alcanzar tu mejor versión.
          </p>
          <p className="text-stone-600 mb-12 leading-relaxed">
            No se trata de dietas extremas ni soluciones rápidas. Se trata de entender tu cuerpo, 
            optimizarlo desde adentro y construir una rutina que funcione en el mundo real, 
            no solo en la teoría médica.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            {values.map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="flex gap-4 items-start"
              >
                <div className="mt-1 flex items-center justify-center p-3 rounded-xl bg-emerald-50 text-emerald-700 shrink-0">
                  {item.icon}
                </div>
                <div>
                  <h4 className="font-bold text-lg text-stone-900 mb-1">{item.title}</h4>
                  <p className="text-sm text-stone-500 leading-relaxed">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
