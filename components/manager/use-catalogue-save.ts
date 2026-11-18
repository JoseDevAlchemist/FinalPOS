"use client";

import { useRef, useState } from "react";
import { uploadProductImageAction, upsertProduct } from "@/lib/products/actions";
import { productImageFileError } from "@/lib/products/image-files";
import { storefrontProductIssue, validateProductDraft } from "@/lib/validation/products";
import type { ProductImageDraft } from "./product-image-fields";

interface CatalogueColourDraft {
  key: string | number;
  id?: string;
  name: string;
  hex: string;
  stockQuantity?: string;
  images: ProductImageDraft[];
}

export function useCatalogueSave(onSaved: (id: string) => void) {
  const requestId = useRef<string | null>(null);
  const locked = useRef(false);
  const uploadResults = useRef(new WeakMap<File, Map<string, string>>());
  const retry = useRef<unknown>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  async function save(details: Record<string, unknown>, colors: CatalogueColourDraft[], productId?: string, wasPublished = false) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError("");
    requestId.current ??= crypto.randomUUID();

    try {
      if (!retry.current) {
        const clientUuid = requestId.current;
        const included = colors.map(({ images, ...color }) => ({
          key: color.key,
          fields: { id: color.id, name: color.name, hex: color.hex, stockQuantity: color.stockQuantity },
          images: images.filter(({ file, imageUrl }) => file || imageUrl.trim()),
        }));
        const draft = {
          ...details,
          clientUuid,
          ...(productId ? { productId } : {}),
          colors: included.map(({ fields, images }) => ({
            ...fields,
            images: images.map(({ angle, file, imageUrl }) => ({ angle, imageUrl: file ? "https://pending.invalid/upload" : imageUrl })),
          })),
        };
        const validation = validateProductDraft(draft);
        if (!validation.success) throw new Error(validation.error.issues[0]?.message ?? "Check the product details.");

        if (validation.data.isWebsitePublished && !wasPublished) {
          const issue = storefrontProductIssue(validation.data);
          if (issue) throw new Error(issue);
        }

        const files = included.flatMap(({ images }) => images.flatMap(({ file }) => file ? [file] : []));
        for (const file of files) {
          const issue = productImageFileError(file);
          if (issue) throw new Error(`${file.name}: ${issue}`);
        }

        let completed = 0;
        for (const [colorIndex, color] of included.entries()) {
          for (const [imageIndex, { angle, file }] of color.images.entries()) {
            if (!file) continue;
            setProgress(`Uploading photo ${completed + 1} of ${files.length}…`);
            const cacheKey = JSON.stringify([color.key, angle]);
            const savedBySlot = uploadResults.current.get(file) ?? new Map<string, string>();
            let url = savedBySlot.get(cacheKey);
            if (!url) {
              const upload = new FormData();
              upload.set("productId", productId ?? clientUuid);
              upload.set("colorKey", String(color.key));
              upload.set("angle", angle);
              upload.set("file", file);
              const result = await uploadProductImageAction(upload).catch(() => null);
              if (!result?.ok) {
                throw new Error(`${file.name}: ${result?.error ?? "Upload could not be confirmed. Retry saving to resume."}`);
              }
              url = result.data.url;
              savedBySlot.set(cacheKey, url);
              uploadResults.current.set(file, savedBySlot);
            }
            draft.colors[colorIndex].images[imageIndex].imageUrl = url;
            completed++;
          }
        }
        retry.current = draft;
      }

      setProgress("Saving product…");
      const result = await upsertProduct(retry.current);
      retry.current = null;
      setConfirming(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.data.id);
    } catch (reason) {
      if (retry.current) {
        setConfirming(true);
        setError("The save result could not be confirmed. Retry this exact save to confirm it.");
      } else {
        setError(reason instanceof Error ? reason.message : "Could not prepare the product.");
      }
    } finally {
      setProgress("");
      setPending(false);
      locked.current = false;
    }
  }

  return { save, error, progress, pending, confirming };
}
