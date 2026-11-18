"use client";

import { useEffect, useRef, useState } from "react";

import { PRODUCT_IMAGE_ACCEPT, productImageFileError } from "@/lib/products/image-files";
import { ANGLE_LABELS, type ProductAngle } from "@/lib/products/types";
import { productAngleSchema } from "@/lib/validation/products";

import { inputClass } from "./form-styles";

export interface ProductImageDraft {
  key: string;
  angle: ProductAngle;
  imageUrl: string;
  file?: File;
}

function ImagePreview({ file, url, alt }: { file?: File; url: string; alt: string }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const target = image.current;
    if (!file || !target) return;
    const objectUrl = URL.createObjectURL(file);
    target.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  if (!file && !url) return null;

  // Preview the original bytes, including device-local object URLs.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} src={file ? undefined : url} alt={alt} className="size-20 rounded-lg bg-well object-contain" />;
}

export function ProductImageFields({ images, angles, disabled, onChange }: {
  images: ProductImageDraft[];
  angles: ProductAngle[];
  disabled: boolean;
  onChange: (images: ProductImageDraft[]) => void;
}) {
  const [error, setError] = useState("");
  const available = angles.filter((angle) => !images.some((image) => image.angle === angle));

  function addFiles(files: File[]) {
    if (disabled || !files.length) return;
    if (files.length > available.length) {
      setError(`Only ${available.length} unused angles are available. Choose fewer files or replace an existing photo.`);
      return;
    }
    setError("");
    onChange([...images, ...available.slice(0, files.length).map((angle, index) => ({
      key: crypto.randomUUID(),
      angle,
      imageUrl: "",
      file: files[index],
    }))]);
  }

  function updateImage(key: string, patch: Partial<ProductImageDraft>) {
    setError("");
    onChange(images.map((image) => image.key === key ? { ...image, ...patch } : image));
  }

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-semibold">Photos</legend>
      <label
        className="block cursor-pointer rounded-lg border border-dashed border-border p-3 text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          addFiles(Array.from(event.dataTransfer.files));
        }}
      >
        Upload images
        <span className="mt-1 block text-xs text-muted">Choose or drop files here. JPEG, PNG, WebP or AVIF, up to 4 MB each.</span>
        <input
          type="file"
          multiple
          accept={PRODUCT_IMAGE_ACCEPT}
          className="mt-2 block w-full min-w-0 text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-well file:px-3 file:py-2"
          onChange={(event) => {
            addFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
      </label>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {images.map((image) => {
        const label = ANGLE_LABELS[image.angle];
        const issue = image.file && productImageFileError(image.file);
        return (
          <div key={image.key} className="grid min-w-0 gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            {issue ? <span className="text-xs text-danger">{issue}</span> :
              <ImagePreview key={image.file ? "local" : "saved"} file={image.file} url={image.imageUrl} alt={`${label} preview`} />}
            <div className="min-w-0 space-y-2">
              <label className="grid gap-1 text-sm">
                Image angle
                <select
                  value={image.angle}
                  className={inputClass}
                  onChange={(event) => {
                    const result = productAngleSchema.safeParse(event.target.value);
                    if (result.success) updateImage(image.key, { angle: result.data });
                  }}
                >
                  {angles.map((angle) => (
                    <option key={angle} value={angle} disabled={angle !== image.angle && !available.includes(angle)}>
                      {ANGLE_LABELS[angle]}
                    </option>
                  ))}
                </select>
              </label>
              {image.file ? <p className="wrap-anywhere text-xs text-muted">{image.file.name}</p> : (
                <label className="grid gap-1 text-sm">
                  {label} image URL
                  <input className={inputClass} placeholder="https://…" value={image.imageUrl} onChange={(event) => updateImage(image.key, { imageUrl: event.target.value })} />
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-border px-3 text-sm focus-within:outline-2 focus-within:outline-accent">
                  Replace photo
                  <input
                    type="file"
                    accept={PRODUCT_IMAGE_ACCEPT}
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) updateImage(image.key, { file });
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button type="button" className="min-h-10 rounded-lg px-3 text-sm text-danger focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => { setError(""); onChange(images.filter(({ key }) => key !== image.key)); }}>
                  Remove photo
                </button>
                {image.file && image.imageUrl ? (
                  <button type="button" className="min-h-10 rounded-lg px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent"
                    onClick={() => updateImage(image.key, { file: undefined })}>Undo replacement</button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
      {available.length ? (
        <button type="button" className="min-h-10 rounded-lg border border-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => onChange([...images, { key: crypto.randomUUID(), angle: available[0], imageUrl: "" }])}>
          Add image URL
        </button>
      ) : null}
    </fieldset>
  );
}
