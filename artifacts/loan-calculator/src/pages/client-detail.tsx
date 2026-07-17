import { useState } from "react";
import { useRoute } from "wouter";
import { Link } from "wouter";
import { useGetClient, useListFiles, useCreateFile, useDeleteFile, useUpdateClient, useUpdateFile, useRollForwardFile } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import ConfirmDialog from "@/components/confirm-dialog";
import { ArrowLeft, ArrowRight, Folder, Plus, Trash2, FileText, Calendar, Pencil, Files, CalendarPlus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { format, addYears, parseISO } from "date-fns";

export default function ClientDetail() {
  const [_, params] = useRoute("/client/:id");
  const clientId = params?.id ?? "";

  const [createOpen, setCreateOpen] = useState(false);
  const [editClientOpen, setEditClientOpen] = useState(false);
  const [editFileOpen, setEditFileOpen] = useState(false);
  const [editFileId, setEditFileId] = useState("");
  const [editFileName, setEditFileName] = useState("");
  const [editFileYearEnd, setEditFileYearEnd] = useState("");
  const [editFileTrivial, setEditFileTrivial] = useState<number | undefined>(undefined);
  const [editFileMateriality, setEditFileMateriality] = useState<number | undefined>(undefined);
  const [rollForwardOpen, setRollForwardOpen] = useState(false);
  const [rollForwardFileId, setRollForwardFileId] = useState("");
  const [rollForwardYearEnd, setRollForwardYearEnd] = useState("");
  const [newName, setNewName] = useState("");
  const [newYearEnd, setNewYearEnd] = useState("");
  const [newTrivial, setNewTrivial] = useState<number | undefined>(undefined);
  const [newMateriality, setNewMateriality] = useState<number | undefined>(undefined);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: client } = useGetClient(clientId);
  const { data: files } = useListFiles(clientId);

  const createFile = useCreateFile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/files`] });
        setCreateOpen(false);
        setNewName("");
        setNewYearEnd("");
        setNewTrivial(undefined);
        setNewMateriality(undefined);
      },
      onError: (err) => {
        toast({ title: "Couldn't create year-end file", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const updateClient = useUpdateClient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}`] });
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        setEditClientOpen(false);
      },
      onError: (err) => {
        toast({ title: "Couldn't update client", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const updateFile = useUpdateFile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/files`] });
        setEditFileOpen(false);
      },
      onError: (err) => {
        toast({ title: "Couldn't update file", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const deleteFile = useDeleteFile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/files`] });
        setDeleteOpen(false);
        setDeleteTarget(null);
      },
      onError: (err) => {
        toast({ title: "Couldn't delete file", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const rollForward = useRollForwardFile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/files`] });
        setRollForwardOpen(false);
        setRollForwardFileId("");
        setRollForwardYearEnd("");
      },
      onError: (err) => {
        toast({ title: "Couldn't roll forward file", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        backHref="/"
        breadcrumb={
          <>
            <Link href="/" className="hover:text-foreground transition-colors font-semibold">Clients</Link>
            <span className="text-border">/</span>
            <span className="text-foreground font-semibold">{client?.name ?? "Client"}</span>
          </>
        }
        title={client?.name ?? "Client"}
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  if (!client) return;
                  setEditName(client.name);
                  setEditCode(client.code ?? "");
                  setEditClientOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
                Edit Client
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit client name and code</TooltipContent>
          </Tooltip>
        }
      />
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <main className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Files className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Year-End Files</h2>
                {files && (
                  <p className="text-sm text-muted-foreground">{files.length} year-end file{files.length !== 1 ? "s" : ""}</p>
                )}
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => setCreateOpen(true)} className="gap-2 shadow-sm hover:shadow-md transition-shadow">
                  <Plus className="h-4 w-4" />
                  Add Year-End File
                </Button>
              </TooltipTrigger>
              <TooltipContent>Create a new year-end file for a client's fiscal year end</TooltipContent>
            </Tooltip>
          </div>

          {files && files.length === 0 && (
            <Card className="border-dashed border-2 border-muted bg-muted/30">
              <CardContent className="py-8 text-center space-y-3">
                <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mx-auto">
                  <Folder className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="text-base font-medium">No year-end files yet</p>
                  <p className="text-sm text-muted-foreground">
                    Create a year-end file for a client's fiscal year end (e.g. December 31, 2024) to start adding loans.
                  </p>
                </div>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Year-End File
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {files?.map((file) => (
              <Card key={file.id} className="group rounded-2xl overflow-hidden hover:shadow-xl hover:shadow-gray-200/50 hover:border-primary/30 transition-all duration-300 shadow-sm flex flex-col p-0 gap-0">
                <CardHeader className="p-6 pb-5 flex-1">
                  <div className="flex items-start justify-between">
                    <div className="flex gap-3 items-start">
                      <div className="w-10 h-10 rounded-xl bg-muted border flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/20 transition-colors shrink-0">
                        <Calendar className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Fiscal Year End
                        </p>
                        <CardTitle className="text-lg font-display mt-0.5 leading-tight">{format(parseISO(file.fiscalYearEnd), "MMMM d, yyyy")}</CardTitle>
                        <CardDescription className="mt-1">{file.name}</CardDescription>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditFileId(file.id);
                              setEditFileName(file.name);
                              setEditFileYearEnd(file.fiscalYearEnd.split("T")[0]);
                              setEditFileTrivial(file.trivialThreshold ?? undefined);
                              setEditFileMateriality(file.materiality ?? undefined);
                              setEditFileOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit year-end file name or date</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setRollForwardFileId(file.id);
                              const nextYear = addYears(parseISO(file.fiscalYearEnd), 1);
                              setRollForwardYearEnd(format(nextYear, "yyyy-MM-dd"));
                              setRollForwardOpen(true);
                            }}
                          >
                            <CalendarPlus className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Roll forward to next fiscal year</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleteTarget(file.id);
                              setDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete year-end file and all loans</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </CardHeader>
                <Link href={`/client/${clientId}/file/${file.id}`} className="cursor-pointer block px-6 py-4 bg-muted/30 border-t flex items-center justify-between group-hover:bg-primary/5 transition-colors">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="text-sm font-semibold">View Loans &amp; Leases</span>
                  </div>
                  <span className="w-8 h-8 rounded-full bg-background border flex items-center justify-center text-muted-foreground group-hover:bg-primary group-hover:border-primary group-hover:text-primary-foreground transition-all shadow-sm">
                    <ArrowRight className="w-4 h-4" />
                  </span>
                </Link>
              </Card>
            ))}
          </div>
        </main>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Add Year-End File</DialogTitle>
            <DialogDescription>
              A year-end file represents a client's fiscal year end audit or review (e.g. December 31, 2024).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="fiscalYearEnd">Fiscal Year End</Label>
              <Input
                id="fiscalYearEnd"
                type="date"
                value={newYearEnd}
                onChange={(e) => setNewYearEnd(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fileName">Name / Reference</Label>
              <Input
                id="fileName"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. December 31, 2024 Audit"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="newTrivial">Trivial Threshold ($)</Label>
                <Input
                  id="newTrivial"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="e.g. 5000"
                  value={newTrivial ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewTrivial(v === "" ? undefined : Number(v));
                  }}
                />
                <p className="text-[11px] text-muted-foreground">FV diffs below this → trivial</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="newMateriality">Materiality ($)</Label>
                <Input
                  id="newMateriality"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="e.g. 50000"
                  value={newMateriality ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewMateriality(v === "" ? undefined : Number(v));
                  }}
                />
                <p className="text-[11px] text-muted-foreground">FV diffs above this → material</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (newName && newYearEnd) {
                  createFile.mutate({
                    id: clientId,
                    data: {
                      name: newName,
                      fiscalYearEnd: newYearEnd,
                      trivialThreshold: newTrivial,
                      materiality: newMateriality,
                    },
                  });
                }
              }}
              disabled={!newName || !newYearEnd || createFile.isPending}
            >
              {createFile.isPending ? "Creating..." : "Create Year-End File"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editClientOpen} onOpenChange={setEditClientOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Edit Client</DialogTitle>
            <DialogDescription>
              Update the client name and code.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editClientName">Client Name</Label>
              <Input
                id="editClientName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editClientCode">Client Code</Label>
              <Input
                id="editClientCode"
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditClientOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editName) {
                  updateClient.mutate({
                    id: clientId,
                    data: { name: editName, code: editCode || undefined },
                  });
                }
              }}
              disabled={!editName || updateClient.isPending}
            >
              {updateClient.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editFileOpen} onOpenChange={setEditFileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Edit Year-End File</DialogTitle>
            <DialogDescription>
              Update the fiscal year end and reference name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editFileFYE">Fiscal Year End</Label>
              <Input
                id="editFileFYE"
                type="date"
                value={editFileYearEnd}
                onChange={(e) => setEditFileYearEnd(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editFileName">Name / Reference</Label>
              <Input
                id="editFileName"
                value={editFileName}
                onChange={(e) => setEditFileName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="editFileTrivial">Trivial Threshold ($)</Label>
                <Input
                  id="editFileTrivial"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="e.g. 5000"
                  value={editFileTrivial ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditFileTrivial(v === "" ? undefined : Number(v));
                  }}
                />
                <p className="text-[11px] text-muted-foreground">FV diffs below this → trivial</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="editFileMateriality">Materiality ($)</Label>
                <Input
                  id="editFileMateriality"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="e.g. 50000"
                  value={editFileMateriality ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditFileMateriality(v === "" ? undefined : Number(v));
                  }}
                />
                <p className="text-[11px] text-muted-foreground">FV diffs above this → material</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFileOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editFileName && editFileYearEnd) {
                  updateFile.mutate({
                    id: editFileId,
                    data: {
                      name: editFileName,
                      fiscalYearEnd: editFileYearEnd,
                      trivialThreshold: editFileTrivial,
                      materiality: editFileMateriality,
                    },
                  });
                }
              }}
              disabled={!editFileName || !editFileYearEnd || updateFile.isPending}
            >
              {updateFile.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Roll Forward File Dialog */}
      <Dialog open={rollForwardOpen} onOpenChange={setRollForwardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Roll Forward Year-End File</DialogTitle>
            <DialogDescription>
              Create a new year-end file for the next fiscal year end and copy all outstanding loans.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rfFYE">New Fiscal Year End</Label>
              <Input
                id="rfFYE"
                type="date"
                value={rollForwardYearEnd}
                onChange={(e) => setRollForwardYearEnd(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollForwardOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (rollForwardFileId && rollForwardYearEnd) {
                  rollForward.mutate({
                    id: rollForwardFileId,
                    data: { newFiscalYearEnd: rollForwardYearEnd },
                  });
                }
              }}
              disabled={!rollForwardFileId || !rollForwardYearEnd || rollForward.isPending}
            >
              {rollForward.isPending ? "Rolling..." : "Roll Forward"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          if (deleteTarget) deleteFile.mutate({ id: deleteTarget });
        }}
        title="Delete Year-End File?"
        description="This will permanently delete the year-end file and all associated loans. This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  );
}
