import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DocumentTemplate } from "@/components/digital/document-template";
import { loadDigitalDocument } from "@/lib/digital/queries";
import { digitalKindSchema } from "@/lib/validation/digital";

export const metadata: Metadata = { title: "Your Pedigree Leather document", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function PublicDocument({ params }: { params: Promise<{ kind: string; id: string; token: string }> }) {
  await connection();
  const parsed = z.object({ kind: digitalKindSchema, id: z.string().uuid(), token: z.string().uuid() }).safeParse(await params);
  if (!parsed.success) notFound();
  const document = await loadDigitalDocument(parsed.data.kind, parsed.data.id, parsed.data.token).catch(() => null);
  if (!document) notFound();
  return <main className="digital-print-root min-h-svh bg-background px-3 py-6 sm:px-8 sm:py-12"><DocumentTemplate document={document} /></main>;
}
