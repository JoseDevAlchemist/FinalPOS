"use client";

import { ImagePlus, Loader2, Plus, Save, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { ProductColorPicker } from "./product-color-picker";
import { useToast } from "@/components/ui/toast";
import { priceAfterDiscount, formatKes } from "@/lib/currency";
import {
  upsertProduct,
  uploadProductImageAction,
} from "@/lib/products/actions";
import {
  ANGLE_LABELS,
  PRODUCT_ANGLES,
  PRODUCT_CATEGORIES,
  type CatalogueProduct,
  type ProductAngle,
  type ProductCategory,
} from "@/lib/products/types";
import { productEditSchema } from "@/lib/validation/products";

interface ImageDraft {
  key: string;
  angle: ProductAngle;
  imageUrl: string;
  uploading: boolean;
}

interface ColorDraft {
  key: string;
  id?: string;
  name: string;
  hex: string;
  stockQuantity: number;
  images: ImageDraft[];
}

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

function initialColors(product: CatalogueProduct): ColorDraft[] {
  if (product.colors.length === 0) {
    return [
      {
        key: "draft-1",
        name: "Default",
        hex: "#8b4513",
        stockQuantity: 0,
        images: [],
      },
    ];
  }

  return product.colors.map((color) => ({
    key: color.id,
    id: color.id,
    name: color.name,
    hex: color.hex,
    stockQuantity: color.stockQuantity,
    images: color.images
      .filter((image) => image.imageUrl)
      .map((image) => ({
        key: image.id,
        angle: image.angle,
        imageUrl: image.imageUrl ?? "",
        uploading: false,
      })),
  }));
}

export function ProductEditForm({ product }: { product: CatalogueProduct }) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description);
  const [category, setCategory] = useState<ProductCategory>(product.category);
  const [basePrice, setBasePrice] = useState(String(product.basePrice));
  const [discountPercent, setDiscountPercent] = useState(
    String(product.discountPercent),
  );
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [active, setActive] = useState(product.active);
  const [isWebsitePublished, setIsWebsitePublished] = useState(
    product.isWebsitePublished,
  );
  const [colors, setColors] = useState<ColorDraft[]>(() =>
    initialColors(product),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nextColorKey = useRef(colors.length + 1);
  const nextImageKey = useRef(1);
  const router = useRouter();
  const toast = useToast();

  const isUploading = colors.some((color) =>
    color.images.some((image) => image.uploading),
  );

  function updateColor(key: string, patch: Partial<ColorDraft>) {
    setColors((current) =>
      current.map((color) =>
        color.key === key ? { ...color, ...patch } : color,
      ),
    );
  }

  function updateImage(
    colorKey: string,
    imageKey: string,
    patch: Partial<ImageDraft>,
  ) {
    setColors((current) =>
      current.map((color) =>
        color.key === colorKey
          ? {
              ...color,
              images: color.images.map((image) =>
                image.key === imageKey ? { ...image, ...patch } : image,
              ),
            }
          : color,
      ),
    );
  }

  function addColor() {
    const key = `draft-${nextColorKey.current++}`;
    setColors((current) => [
      ...current,
      {
        key,
        name: "",
        hex: "#8b4513",
        stockQuantity: 0,
        images: [],
      },
    ]);
  }

  function removeColor(key: string) {
    if (colors.length <= 1) {
      toast.error("Keep one colour", "A product needs at least one colour.");
      return;
    }
    setColors((current) => current.filter((color) => color.key !== key));
  }

  function addImage(colorKey: string) {
    const color = colors.find((entry) => entry.key === colorKey);
    if (!color) return;

    const nextAngle = PRODUCT_ANGLES.find(
      (angle) => !color.images.some((image) => image.angle === angle),
    );

    if (!nextAngle) {
      toast.error("All angles are used", "Remove an image before adding another.");
      return;
    }

    updateColor(colorKey, {
      images: [
        ...color.images,
        {
          key: `image-${nextImageKey.current++}`,
          angle: nextAngle,
          imageUrl: "",
          uploading: false,
        },
      ],
    });
  }

  function removeImage(colorKey: string, imageKey: string) {
    const color = colors.find((entry) => entry.key === colorKey);
    const image = color?.images.find((entry) => entry.key === imageKey);
    if (image?.uploading) {
      toast.error("Upload still running", "Wait for this image to finish.");
      return;
    }

    updateColor(colorKey, {
      images: color?.images.filter((entry) => entry.key !== imageKey) ?? [],
    });
  }

  async function uploadImage(
    colorKey: string,
    imageKey: string,
    file: File,
  ) {
    const color = colors.find((entry) => entry.key === colorKey);
    const image = color?.images.find((entry) => entry.key === imageKey);
    if (!color || !image) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error(
        "That file cannot be used",
        "Upload a JPEG, PNG, WebP or AVIF image.",
      );
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("That image is too large", "Images must be smaller than 4MB.");
      return;
    }

    updateImage(colorKey, imageKey, { uploading: true });

    const formData = new FormData();
    formData.set("productId", product.id);
    formData.set("colorKey", color.id ?? color.key);
    formData.set("angle", image.angle);
    formData.set("file", file);

    const result = await uploadProductImageAction(formData);

    if (result.ok) {
      updateImage(colorKey, imageKey, {
        imageUrl: result.data.url,
        uploading: false,
      });
      toast.success("Image uploaded", "Save the product to keep it.");
      return;
    }

    updateImage(colorKey, imageKey, { uploading: false });
    toast.error("Upload failed", result.error);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (isUploading) {
      setFormError("Wait for the image uploads to finish before saving.");
      return;
    }

    const payload = {
      productId: product.id,
      name,
      description,
      category,
      basePrice,
      discountPercent,
      barcode: barcode.trim() === "" ? null : barcode,
      active,
      isWebsitePublished,
      colors: colors.map((color) => ({
        id: color.id,
        name: color.name,
        hex: color.hex,
        images: color.images
          .filter((image) => image.imageUrl.trim().length > 0)
          .map((image) => ({
            angle: image.angle,
            imageUrl: image.imageUrl,
          })),
      })),
    };

    const parsed = productEditSchema.safeParse(payload);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Check the product details.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await upsertProduct(parsed.data);
        if (!result.ok) {
          setFormError(result.error);
          return;
        }
        toast.success("Product saved", name);
        router.refresh();
        router.push("/manager/products");
      } catch {
        setFormError("Could not confirm the product. Check the saved details before retrying.");
      }
    });
  }

  const price = Number(basePrice);
  const discount = Number(discountPercent);
  const previewPrice =
    Number.isFinite(price) && Number.isFinite(discount)
      ? priceAfterDiscount(price, discount)
      : null;

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-28">
      {formError ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-foreground"
        >
          {formError}
        </p>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-serif text-xl font-semibold text-foreground">
          Product details
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-semibold text-foreground sm:col-span-2">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-foreground sm:col-span-2">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
            Category
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as ProductCategory)
              }
              className={inputClass}
            >
              {PRODUCT_CATEGORIES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry === "bag" ? "Bags" : "Shoes"}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
            Barcode
            <input
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              className={inputClass}
              autoComplete="off"
              placeholder="PED-KARURA-001"
            />
            <span className="text-xs font-normal leading-5 text-muted">
              Printed as CODE128. Leave blank to disable label printing.
            </span>
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
            Base price (KES)
            <input
              type="number"
              min={0}
              step={1}
              value={basePrice}
              onChange={(event) => setBasePrice(event.target.value)}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
            Discount (%)
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={discountPercent}
              onChange={(event) => setDiscountPercent(event.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        {previewPrice !== null ? (
          <p className="mt-4 rounded-lg bg-well p-3 text-sm text-muted">
            Website price after discount:{" "}
            <span className="font-semibold text-foreground">
              {formatKes(previewPrice)}
            </span>
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-serif text-xl font-semibold text-foreground">
          Visibility
        </h2>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              <span className="block font-semibold text-foreground">
                Active in the till
              </span>
              <span className="mt-1 block text-muted">
                Inactive products are hidden from the till and the website.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-sm">
            <input
              type="checkbox"
              checked={isWebsitePublished}
              onChange={(event) => setIsWebsitePublished(event.target.checked)}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              <span className="block font-semibold text-foreground">
                Publish on website
              </span>
              <span className="mt-1 block text-muted">
                The product must also be active to appear on the storefront.
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-semibold text-foreground">
              Colours and images
            </h2>
            <p className="mt-1 text-sm text-muted">
              Stock is changed from the products list so every movement is
              logged. New colours start at zero.
            </p>
          </div>
          <button
            type="button"
            onClick={addColor}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Plus aria-hidden="true" className="size-4" />
            Add colour
          </button>
        </div>

        <div className="mt-5">
          <ProductColorPicker selected={colors.map((color) => color.name)} disabled={pending || isUploading} onToggle={(option) => {
            const existing = colors.find((color) => color.name.toLowerCase() === option.name.toLowerCase());
            if (existing) {
              if (product.colors.some((saved) => saved.id === existing.id && saved.stockQuantity > 0)) {
                toast.error("Colour has stock", "Adjust its stock before removing this colour.");
                return;
              }
              removeColor(existing.key);
            } else if (colors.length < 30) {
              const key = `draft-${nextColorKey.current++}`;
              setColors((current) => [...current, { key, ...option, stockQuantity: 0, images: [] }]);
            }
          }} />
        </div>
        <div className="mt-5 flex flex-col gap-5">
          {colors.map((color) => (
            <div
              key={color.key}
              className="rounded-xl border border-border bg-background p-4"
            >
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
                  Colour
                  <input
                    value={color.name}
                    onChange={(event) =>
                      updateColor(color.key, { name: event.target.value })
                    }
                    className={`${inputClass} w-44`}
                    placeholder="Tan"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
                  Swatch
                  <span className="flex h-10 items-center gap-2">
                    <input
                      type="color"
                      value={color.hex}
                      onChange={(event) =>
                        updateColor(color.key, { hex: event.target.value })
                      }
                      aria-label={`${color.name || "Colour"} swatch`}
                      className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-background p-1"
                    />
                    <span className="text-xs font-medium text-muted">
                      {color.hex}
                    </span>
                  </span>
                </label>

                <div className="flex h-10 items-center gap-2 rounded-lg bg-well px-3 text-xs font-semibold text-muted">
                  Stock
                  <span className="text-sm text-foreground">
                    {product.colors.find((saved) => saved.id === color.id)?.stockQuantity ?? 0}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => removeColor(color.key)}
                  className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                  Remove
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                {color.images.map((image) => {
                  const usedAngles = new Set(
                    color.images
                      .filter((entry) => entry.key !== image.key)
                      .map((entry) => entry.angle),
                  );

                  return (
                    <div
                      key={image.key}
                      className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-[110px_1fr_auto] sm:items-center"
                    >
                      <select
                        value={image.angle}
                        onChange={(event) =>
                          updateImage(color.key, image.key, {
                            angle: event.target.value as ProductAngle,
                          })
                        }
                        aria-label="Image angle"
                        className={inputClass}
                      >
                        {PRODUCT_ANGLES.map((angle) => (
                          <option
                            key={angle}
                            value={angle}
                            disabled={usedAngles.has(angle)}
                          >
                            {ANGLE_LABELS[angle]}
                          </option>
                        ))}
                      </select>

                      <input
                        value={image.imageUrl}
                        onChange={(event) =>
                          updateImage(color.key, image.key, {
                            imageUrl: event.target.value,
                          })
                        }
                        aria-label={`${ANGLE_LABELS[image.angle]} image URL`}
                        placeholder="https://… or upload a file"
                        className={inputClass}
                      />

                      <div className="flex items-center gap-2">
                        <label
                          className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${image.uploading ? "pointer-events-none opacity-60" : ""}`}
                        >
                          {image.uploading ? (
                            <Loader2
                              aria-hidden="true"
                              className="size-4 animate-spin"
                            />
                          ) : (
                            <Upload aria-hidden="true" className="size-4" />
                          )}
                          {image.uploading ? "Uploading" : "Upload"}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/avif"
                            className="sr-only"
                            disabled={image.uploading}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              if (file) {
                                void uploadImage(color.key, image.key, file);
                              }
                            }}
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => removeImage(color.key, image.key)}
                          disabled={image.uploading}
                          aria-label="Remove image"
                          className="rounded-lg p-2 text-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
                        >
                          <Trash2 aria-hidden="true" className="size-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={() => addImage(color.key)}
                  className="inline-flex h-9 w-fit items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm font-semibold text-muted transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <ImagePlus aria-hidden="true" className="size-4" />
                  Add image
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-2">
          <Link
            href="/manager/products"
            className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/5"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={pending || isUploading}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-cream transition-colors hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="size-4" />
            )}
            Save product
          </button>
        </div>
      </div>
    </form>
  );
}
