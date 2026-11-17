import type { Metadata } from "next";

import { BrandPanel } from "@/components/auth/brand-panel";
import { PinKeypad } from "@/components/auth/pin-keypad";
import { BrandMark } from "@/components/brand-mark";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <main className="grid min-h-svh flex-1 lg:grid-cols-2">
      <BrandPanel />

      <section className="flex items-center justify-center bg-background px-6 py-14 lg:px-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center lg:hidden">
            <BrandMark size={64} tagline />
          </div>
          <PinKeypad />
        </div>
      </section>
    </main>
  );
}
