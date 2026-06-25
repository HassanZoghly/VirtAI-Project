import { motion } from 'framer-motion';

export default function SectionHeader({ titlePrefix, titleHighlight, description, className = '', descriptionClassName = 'mt-5 text-lg leading-relaxed text-offwhite/70' }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.6 }}
    >
      <h2
        className="display-h2 text-offwhite"
      >
        {titlePrefix} <span className="text-gold">{titleHighlight}</span>
      </h2>
      <p className={descriptionClassName}>
        {description}
      </p>
    </motion.div>
  );
}
