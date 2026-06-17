import team from '@/features/overview/data/team';
import { motion } from 'motion/react';

export default function Footer() {
  return (
    <footer id="team" className="border-t border-white/10 bg-dark px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <motion.h2
          className="mb-12 text-center text-3xl font-bold text-offwhite sm:text-4xl"
          style={{ fontFamily: 'var(--font-display)' }}
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
        >
          Meet the <span className="text-gold">Team</span>
        </motion.h2>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
          {team.map((member, i) => (
            <motion.a
              key={member.name}
              href={member.github}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col items-center gap-3 text-center"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
            >
              <img
                src={member.avatar}
                alt=""
                role="presentation"
                width={80}
                height={80}
                className="h-20 w-20 rounded-full border-2 border-white/10 object-cover transition-colors transition-shadow duration-300 group-hover:border-gold group-hover:shadow-[0_0_20px_rgba(180, 171, 139, 0.3)]"
                loading="lazy"
                decoding="async"
              />
              <span className="text-sm font-medium text-offwhite/80 transition-colors group-hover:text-gold">
                {member.name}
              </span>
            </motion.a>
          ))}
        </div>

        <p className="mx-auto mt-16 text-center text-xs text-offwhite/60">
          &copy; {new Date().getFullYear()} VirtAI &mdash; Graduation Project
        </p>
      </div>
    </footer>
  );
}
