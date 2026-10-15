import React from "react";
import { motion } from "motion/react";
import { Heart, Shield, Users, Leaf } from "lucide-react";

// T1/S2c — the two Unsplash photos ship as `srcset` width variants instead of
// a single fixed `w=1080` file. Only the URL stem is shared; each variant
// appends its own `w=`. The rendered layout is untouched: both images live in
// fixed-size containers (`h-[450px] lg:h-[600px]` / `h-[300px]`) with
// `w-full h-full object-cover`, and the explicit width/height only describe
// the intrinsic ratio (1080×720) so the browser can reserve the box.
const MAIN_PHOTO =
  "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxoZWFsdGh5JTIwd2VsbG5lc3MlMjBmaXRuZXNzfGVufDF8fHx8MTc3MzA0NjIyNHww&ixlib=rb-4.1.0&q=80";
const OVERLAP_PHOTO =
  "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?fm=jpg&q=80&fit=max";

const PHOTO_WIDTHS = [480, 768, 1080, 1440];

function photoSrcSet(stem: string): string {
  return PHOTO_WIDTHS.map((w) => `${stem}&w=${w} ${w}w`).join(", ");
}

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
          className="relative h-full w-full min-h-[400px] sm:min-h-[500px]"
        >
          {/* Main Photo */}
          <div className="relative z-10 w-4/5 h-[300px] sm:h-[450px] lg:h-[600px] ml-auto overflow-hidden shadow-2xl rounded-2xl">
            <img 
              src={`${MAIN_PHOTO}&w=1080`}
              srcSet={photoSrcSet(MAIN_PHOTO)}
              sizes="(min-width: 1024px) 40vw, 80vw"
              width={1080}
              height={720}
              alt="Bienestar y salud preventiva" 
              loading="lazy"
              className="w-full h-full object-cover"
            />
          </div>
          {/* Overlapping Photo */}
          <div className="absolute bottom-10 left-0 z-20 w-3/5 h-[200px] sm:h-[300px] shadow-xl border-4 border-white overflow-hidden rounded-xl">
             <img 
              src={`${OVERLAP_PHOTO}&w=1080`}
              srcSet={photoSrcSet(OVERLAP_PHOTO)}
              sizes="(min-width: 1024px) 26vw, 60vw"
              width={1080}
              height={720}
              alt="Alimentación saludable" 
              loading="lazy"
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
                  <h3 className="font-bold text-lg text-stone-900 mb-1">{item.title}</h3>
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
