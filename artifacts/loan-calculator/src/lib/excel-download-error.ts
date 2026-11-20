import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "./errors";
export function notifyExcelError(err: unknown) {
  toast({
    title: "Couldn't download Excel report",
    description: getErrorMessage(err),
    variant: "destructive",
  });
}
