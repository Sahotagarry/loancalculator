import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { HelpDialog } from "@/components/help-dialog";
import logoWhite from "@assets/clearline-logo-white.png";

interface PageHeaderProps {
  backHref?: string;
  breadcrumb?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ backHref, breadcrumb, title, meta, actions }: PageHeaderProps) {
  return (
    <header className="dark sticky top-0 z-40 border-b border-[#3a3a3a] bg-[#262626] text-foreground">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        {backHref && (
          <Link href={backHref} className="cursor-pointer flex-shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
        )}
        <div className="min-w-0 flex-1 basis-52">
          {breadcrumb && (
            <nav className="flex items-center gap-1.5 text-xs text-muted-foreground overflow-hidden whitespace-nowrap">
              {breadcrumb}
            </nav>
          )}
          <div className="flex items-baseline gap-x-3 gap-y-0.5 flex-wrap">
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-foreground font-display truncate max-w-full">
              {title}
            </h1>
            {meta}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2.5 ml-auto flex-shrink-0 min-w-0">
          <img
            src={logoWhite}
            alt="Clearline Logo"
            className="hidden sm:block h-7 w-auto object-contain flex-shrink-0"
          />
          <div className="flex flex-wrap items-center gap-2 justify-end min-w-0">
            {actions}
            <HelpDialog />
          </div>
        </div>
      </div>
    </header>
  );
}
