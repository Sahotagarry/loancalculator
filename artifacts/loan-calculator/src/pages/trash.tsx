import { useState } from "react";
import {
  useListTrash,
  useRestoreTrashItem,
  usePurgeTrashItem,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/confirm-dialog";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { Trash2, Undo2, Building2, FolderOpen, Landmark, FileText } from "lucide-react";

type TrashType = "client" | "file" | "loan";

function formatDeletedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

export default function TrashPage() {
  const { data: trash, isLoading } = useListTrash();
  const [purgeTarget, setPurgeTarget] = useState<{ type: TrashType; id: string; label: string } | null>(null);

  const invalidateAll = () => {
    queryClient.invalidateQueries();
  };

  const restore = useRestoreTrashItem({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        toast({ title: "Restored", description: "The item is back where it was." });
      },
      onError: (err) => {
        toast({ title: "Couldn't restore", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const purge = usePurgeTrashItem({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        toast({ title: "Permanently deleted" });
      },
      onError: (err) => {
        toast({ title: "Couldn't delete", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const isEmpty =
    !isLoading &&
    trash &&
    trash.clients.length === 0 &&
    trash.files.length === 0 &&
    trash.loans.length === 0;

  const row = (opts: {
    key: string;
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    deletedAt: string | null | undefined;
    type: TrashType;
    id: string;
  }) => (
    <div key={opts.key} className="flex items-center gap-3 py-3 border-b last:border-b-0">
      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
        {opts.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{opts.title}</p>
        <p className="text-xs text-muted-foreground truncate">
          {opts.subtitle}
          {opts.deletedAt ? ` · Deleted ${formatDeletedAt(opts.deletedAt)}` : ""}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={restore.isPending || purge.isPending}
        onClick={() => restore.mutate({ type: opts.type, id: opts.id })}
      >
        <Undo2 className="h-4 w-4 mr-1.5" />
        Restore
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        disabled={restore.isPending || purge.isPending}
        onClick={() => setPurgeTarget({ type: opts.type, id: opts.id, label: opts.title })}
      >
        <Trash2 className="h-4 w-4" />
        <span className="sr-only">Delete permanently</span>
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        backHref="/"
        title="Trash"
        meta={
          <span className="text-sm text-muted-foreground hidden md:inline">
            Deleted items stay here until you restore them or delete them permanently.
          </span>
        }
      />
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {isLoading && <p className="text-muted-foreground">Loading…</p>}

        {isEmpty && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Trash2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p>The trash is empty.</p>
              <p className="text-xs mt-1">
                When you delete a client, year-end file, or loan/lease, it will show up here so you can get it back.
              </p>
            </CardContent>
          </Card>
        )}

        {trash && trash.clients.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" /> Clients
              </CardTitle>
              <CardDescription>
                Restoring a client brings back all of its year-end files and loans/leases.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {trash.clients.map((c) =>
                row({
                  key: c.id,
                  icon: <Building2 className="h-4 w-4 text-muted-foreground" />,
                  title: c.name,
                  subtitle: "Client",
                  deletedAt: c.deletedAt,
                  type: "client",
                  id: c.id,
                })
              )}
            </CardContent>
          </Card>
        )}

        {trash && trash.files.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-primary" /> Year-End Files
              </CardTitle>
              <CardDescription>
                Restoring a year-end file brings back all of its loans and leases.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {trash.files.map((f) =>
                row({
                  key: f.id,
                  icon: <FileText className="h-4 w-4 text-muted-foreground" />,
                  title: f.fiscalYearEnd ? `${f.fiscalYearEnd} — ${f.name}` : f.name,
                  subtitle: `Year-end file for ${f.clientName}`,
                  deletedAt: f.deletedAt,
                  type: "file",
                  id: f.id,
                })
              )}
            </CardContent>
          </Card>
        )}

        {trash && trash.loans.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Landmark className="h-4 w-4 text-primary" /> Loans & Leases
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trash.loans.map((l) =>
                row({
                  key: l.id,
                  icon: <Landmark className="h-4 w-4 text-muted-foreground" />,
                  title: l.name,
                  subtitle: `${l.isCapitalLease ? "Lease" : "Loan"} · ${l.clientName}${l.fiscalYearEnd ? ` · FYE ${l.fiscalYearEnd}` : ""}`,
                  deletedAt: l.deletedAt,
                  type: "loan",
                  id: l.id,
                })
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={purgeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPurgeTarget(null);
        }}
        title="Delete permanently?"
        description={`"${purgeTarget?.label ?? ""}" will be permanently deleted, along with everything inside it. This cannot be undone.`}
        confirmText="Delete permanently"
        onConfirm={() => {
          if (purgeTarget) {
            purge.mutate({ type: purgeTarget.type, id: purgeTarget.id });
            setPurgeTarget(null);
          }
        }}
      />
    </div>
  );
}
