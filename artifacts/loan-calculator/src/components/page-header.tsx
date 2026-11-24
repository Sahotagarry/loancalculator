import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LogOut } from "lucide-react";
import { HelpDialog } from "@/components/help-dialog";
import { useAuth, EASY_AUTH_LOGOUT_URL } from "@/hooks/use-auth";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import logoWhite from "../assets/clearline-logo-white.png";
import { formatBuildTime } from "@/lib/build-time";

interface PageHeaderProps {
  backHref?: string;
  breadcrumb?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  subtitle?: ReactNode;
  /** Keep a wide action group out of the identity row. */
  actionLayout?: "inline" | "toolbar";
  toolbarMeta?: ReactNode;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  accountant: "Accountant",
  read_only: "Read Only",
};

export function PageHeader({ backHref, breadcrumb, title, meta, actions, subtitle, actionLayout = "inline", toolbarMeta }: PageHeaderProps) {
  const { user, isDevIdentity } = useAuth();
  const toolbar = actionLayout === "toolbar";
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
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground overflow-hidden whitespace-nowrap">
              {breadcrumb}
            </nav>
          )}
          <div className="flex items-baseline gap-x-3 gap-y-0.5 flex-wrap">
            <h1 className={`${toolbar ? "text-xl md:text-2xl" : "text-lg md:text-xl"} font-bold tracking-tight text-foreground font-display truncate max-w-full`} title={typeof title === "string" ? title : undefined}>
              {title}
            </h1>
            {meta}
          </div>
          {subtitle && <div className="text-sm text-muted-foreground mt-0.5 break-words" data-testid="page-header-subtitle">{subtitle}</div>}
        </div>
        <div className={toolbar
          ? "flex items-center gap-3 ml-auto shrink-0"
          : "flex w-full flex-col items-end gap-2.5 sm:ml-auto sm:w-auto sm:flex-shrink-0 min-w-0"}>
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            <img
              src={logoWhite}
              alt="Clearline Logo"
              className="h-7 w-auto object-contain"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-[10px] leading-none text-muted-foreground cursor-help rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  data-testid="text-app-version"
                  aria-label={`Version ${__APP_VERSION__}, build details`}
                >
                  v{__APP_VERSION__}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" data-testid="tooltip-app-build">
                Built: {formatBuildTime(__APP_BUILD_TIME__)} (Vancouver)
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 justify-end min-w-0 sm:w-auto">
            {!toolbar && actions}
            <HelpDialog />
            {user && (
              <div className="flex items-center gap-2 min-w-0">
                <div className="hidden md:flex flex-col items-end leading-none">
                  {user.displayName && (
                    <span
                      className="text-xs text-foreground truncate max-w-40 font-medium"
                      data-testid="text-signed-in-user"
                    >
                      {user.displayName}
                    </span>
                  )}
                  {user.role && (
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      {ROLE_LABELS[user.role] || user.role}
                    </span>
                  )}
                </div>
              {!isDevIdentity && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    data-testid="button-sign-out"
                  >
                    <a href={EASY_AUTH_LOGOUT_URL}>
                      <LogOut className="h-4 w-4" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Sign out{user.displayName ? ` (${user.displayName})` : ""}
                </TooltipContent>
              </Tooltip>
              )}
              </div>
            )}
          </div>
        </div>
        {toolbar && (actions || toolbarMeta) && (
          <div className="w-full flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-white/10 pt-2" data-testid="page-header-toolbar">
            <div className="min-w-0">{actions}</div>
            {toolbarMeta && <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">{toolbarMeta}</div>}
          </div>
        )}
      </div>
    </header>
  );
}
