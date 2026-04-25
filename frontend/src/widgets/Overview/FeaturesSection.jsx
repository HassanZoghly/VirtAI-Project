import features from '@/features/overview/data/features';
import CardHoverEffect from '@/shared/ui/CardHoverEffect';
import { motion } from 'motion/react';

export default function FeaturesSection() {
  return (
    <section id="features" className="relative mx-auto max-w-6xl px-6 py-28">
      <motion.div
        className="mb-14 text-center"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6 }}
      >
        <h2 className="text-4xl font-bold text-offwhite sm:text-5xl">
          Core <span className="text-gold">Features</span>
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-offwhite/70">
          Everything you need for an immersive AI-powered learning experience.
        </p>
      </motion.div>

      <CardHoverEffect
        items={features.map((f) => ({
          id: f.id,
          icon: f.icon,
          title: f.title,
          description: f.description,
          ...(f.id === 'avatar' && { colSpan: 2 }),
        }))}
      />
    </section>
  );
}
