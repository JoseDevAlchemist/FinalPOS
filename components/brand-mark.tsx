import Image from "next/image";

export function BrandMark({
  size = 44,
  tagline = false,
  className,
}: {
  size?: number;
  tagline?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-3 ${className ?? ""}`}>
      <Image
        src="/pedigree-logo.png"
        alt="Pedigree Leather"
        width={size}
        height={size}
        priority
        className="rounded-full"
      />
      {tagline ? (
        <span className="flex flex-col leading-none">
          <span className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Pedigree
          </span>
          <span className="text-[0.6875rem] font-semibold tracking-[0.22em] text-muted uppercase">
            Point of Sale
          </span>
        </span>
      ) : null}
    </span>
  );
}
