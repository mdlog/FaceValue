"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectWallet } from "@/components/connect-wallet";

const LINKS = [
  { href: "/", label: "Catalog" },
  { href: "/wallet", label: "Wallet" },
  { href: "/resale", label: "Resale" },
  { href: "/door", label: "Door Scan" },
  { href: "/audit", label: "Audit" },
];

export function TopNav() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // Collapse the mobile menu whenever the route changes.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-ink/15 bg-paper/85 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          onClick={() => setOpen(false)}
        >
          <span className="grid h-8 w-8 place-items-center rounded-[5px] bg-ink text-paper">
            <ShieldCheck className="h-4.5 w-4.5" strokeWidth={2.2} />
          </span>
          <span className="leading-none">
            <span className="block font-display text-lg tracking-tight text-ink">
              FaceValue
            </span>
            <span className="block font-mono text-[9px] uppercase tracking-[0.2em] text-private">
              Regulated Resale
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-2">
          {/* desktop nav */}
          <nav className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "rounded-[5px] px-3 py-2 font-mono text-[12px] uppercase tracking-[0.08em] transition-colors",
                    active
                      ? "bg-ink text-paper"
                      : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>

          <ConnectWallet />

          {/* mobile menu toggle */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="grid h-11 w-11 place-items-center rounded-[5px] text-ink transition-colors hover:bg-ink/5 md:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* mobile dropdown panel */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.nav
            id="mobile-nav"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden border-t border-ink/10 bg-paper/95 backdrop-blur-sm md:hidden"
          >
            <div className="mx-auto max-w-6xl px-4 py-2 sm:px-6">
              {LINKS.map((l) => {
                const active = pathname === l.href;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "block rounded-[5px] px-3 py-3 font-mono text-[13px] uppercase tracking-[0.08em] transition-colors",
                      active
                        ? "bg-ink text-paper"
                        : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                    )}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
