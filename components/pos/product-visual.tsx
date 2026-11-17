"use client";

import Image from "next/image";
import { useState } from "react";

export function ProductVisual({ name, colorName, colorHex, imageUrl }: {
  name: string;
  colorName?: string;
  colorHex?: string;
  imageUrl: string | null;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = imageUrl && imageUrl !== failedUrl;

  return (
    <div className="flex size-20 shrink-0 items-center justify-center">
      {showImage ? (
        <Image
          src={imageUrl}
          alt={`${name}${colorName ? ` — ${colorName}` : ""} product image`}
          width={80}
          height={80}
          unoptimized
          onError={() => setFailedUrl(imageUrl)}
          className="size-full rounded-xl border border-border bg-well object-cover"
        />
      ) : (
        <div role="img" aria-label={`${name} colour swatch${colorName ? `: ${colorName}` : ""}`}
          className="size-16 rounded-full bg-well shadow-sm ring-2 ring-border"
          style={{ backgroundColor: colorHex }} />
      )}
    </div>
  );
}
