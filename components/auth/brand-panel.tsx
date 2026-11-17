"use client";

import { motion } from "framer-motion";

import { BrandMark } from "@/components/brand-mark";

function StitchArtwork() {
  return (
    <svg
      viewBox="0 0 240 240"
      fill="none"
      aria-hidden="true"
      className="size-[28rem] text-cream opacity-[0.07]"
    >
      <path
        d="M24 96 H216"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray="2 14"
      />
      <path
        d="M24 144 H216"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray="2 14"
      />
      <path
        d="M84 96 V144 M120 96 V144 M156 96 V144 M192 96 V144"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray="2 11"
      />
    </svg>
  );
}

export function BrandPanel() {
  return (
    <section
      aria-hidden="true"
      className="relative hidden overflow-hidden bg-primary-dark px-16 py-16 text-cream lg:flex lg:flex-col lg:items-center lg:justify-center"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--color-primary-dark)_0%,var(--color-primary)_55%,var(--color-primary-deep)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(245,233,217,0.07),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(20,12,10,0.65)_100%)]" />

      <div className="absolute inset-0 grid place-items-center">
        <StitchArtwork />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
        className="relative z-10 flex w-full max-w-md flex-col items-center gap-8 rounded-2xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur-md sm:p-12"
      >
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.15, ease: "easeOut" }}
        >
          <div className="drop-shadow-[0_18px_44px_rgba(0,0,0,0.65)]">
            <BrandMark size={180} />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
        >
          <h2 className="font-serif text-3xl font-semibold leading-tight tracking-tight text-cream sm:text-4xl">
            The workshop till, rebuilt online-first.
          </h2>
          <p className="mt-4 text-[0.65rem] font-semibold tracking-[0.3em] text-accent-ink uppercase">
            Pedigree Leather • Nairobi
          </p>
        </motion.div>
      </motion.div>
    </section>
  );
}
