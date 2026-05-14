import Link from "next/link";

type Props = {
  eyebrow?: string;
  title: string;
  nav?: React.ReactNode;
};

export function BrandHeader({ eyebrow, title, nav }: Props) {
  return (
    <header className="border-b border-rule bg-white">
      <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between gap-6">
        <div>
          {eyebrow && (
            <div className="muted text-xs uppercase tracking-wider mb-1">
              {eyebrow}
            </div>
          )}
          <Link href="/" className="heading text-xl no-underline text-ink">
            {title}
          </Link>
        </div>
        {nav && <nav className="flex items-center gap-4 text-sm">{nav}</nav>}
      </div>
    </header>
  );
}
