"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2, Mail, Share2 } from "lucide-react";

/**
 * Share a job. On a phone it opens the device's own share sheet; elsewhere a small menu with Copy link,
 * LinkedIn, WhatsApp, X and Email. The link is the job's own careers page address.
 */
export function ShareJob({ title, path }: { title: string; path: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const url = () => new URL(path, window.location.origin).toString();
  const text = `${title} at WonderID`;

  const share = async () => {
    const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    if (touch && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: text, text, url: url() });
        return;
      } catch (err) {
        // Dismissing the sheet is not a failure; anything else falls back to the menu.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    setOpen((o) => !o);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", url());
    }
  };

  const enc = encodeURIComponent;
  const targets = () => [
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url())}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${enc(`${text} ${url()}`)}` },
    { label: "X", href: `https://x.com/intent/post?text=${enc(text)}&url=${enc(url())}` },
  ];
  const item = "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

  return (
    <div ref={box} className="relative inline-block">
      <button
        type="button"
        onClick={share}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Share2 className="size-4" aria-hidden="true" /> Share
      </button>
      {open && (
        <div role="menu" aria-label="Share this job" className="absolute left-0 z-20 mt-2 w-52 rounded-lg border border-border bg-popover p-1 shadow-lg">
          <button type="button" role="menuitem" onClick={copy} className={item}>
            {copied ? <Check className="size-4 text-success" aria-hidden="true" /> : <Link2 className="size-4" aria-hidden="true" />}
            {copied ? "Link copied" : "Copy link"}
          </button>
          {targets().map((t) => (
            <a key={t.label} role="menuitem" href={t.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={item}>
              <Share2 className="size-4" aria-hidden="true" /> {t.label}
            </a>
          ))}
          <a role="menuitem" href={`mailto:?subject=${enc(text)}&body=${enc(`${text}\n\n${url()}`)}`} onClick={() => setOpen(false)} className={item}>
            <Mail className="size-4" aria-hidden="true" /> Email
          </a>
        </div>
      )}
    </div>
  );
}
